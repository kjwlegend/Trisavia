import type {AgentRuntimeGuideProvider} from './agent-runtime-guide.ts';
import {currentAgentRuntime,runtimeRuleMetadata,runtimeCatalogRevision} from './agent-runtime-publication.ts';
import type {CommandKey,CommandReceipt,RuntimeReadContext,RuntimeStore,RuntimeTransaction} from '../contracts/runtime-store.ts';
import type {JsonObject,JsonValue} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {fail,object,text} from '../domains/common/errors.ts';
import {AUTONOMOUS_WORLD_ACTIONS} from '../domains/access/world-action-policy.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
import {createPublicWorldReader,type PublicWorldRequest} from './public-world-read-cache.ts';
export interface GatewayOperation {
 id:string;moduleId:string;schemaVersion:number;kind:'query'|'command';actors:('agent'|'owner')[];description:string;
 input:JsonObject;output:JsonObject;
 query?:(ctx:RuntimeReadContext,principal:Principal,input:JsonObject)=>Promise<JsonObject>;
 command?:(ctx:RuntimeTransaction,principal:Principal,key:CommandKey,input:JsonObject)=>Promise<CommandReceipt>;
 authorizeReceipt?:(ctx:RuntimeReadContext,principal:Principal,receipt:CommandReceipt)=>Promise<void>;
}
export interface GatewayGuide {moduleId:string;version:number;document:JsonObject}
export interface GatewayPublicRead {id:string;moduleId:string;schemaVersion:number;path:string;description:string;input:JsonObject;output:JsonObject;read:(ctx:RuntimeReadContext,input:JsonObject)=>Promise<JsonObject>}
export type GatewayValidator=(schema:JsonObject,input:unknown)=>boolean;
export function canonicalGatewayDocument(value:JsonValue):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalGatewayDocument).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalGatewayDocument(value[key]!)).join(',')+'}';
}
export const gatewayBaseInput:JsonObject={type:'object',additionalProperties:false,required:['protocolVersion','consumerId','purpose','operation','input'],properties:{protocolVersion:{const:1},consumerId:{type:'string',minLength:1,maxLength:100},purpose:{enum:['agent-manual','human-inspect']},operation:{type:'string',minLength:1,maxLength:100},input:{type:'object'},commandId:{type:'string',minLength:8,maxLength:100}}};
export function gatewayEnvelope(data:JsonObject):JsonObject{return {type:'object',additionalProperties:false,required:['protocolVersion','requestId','instanceId','serverTime','data'],properties:{protocolVersion:{const:1},requestId:{type:'string'},instanceId:{type:'string'},serverTime:{type:'integer'},data}};}
export interface GatewaySchemaDocument {id:string;version:number;document:JsonObject}
export function gatewayOperationSchemas(operation:GatewayOperation):GatewaySchemaDocument[]{
 const request=structuredClone(gatewayBaseInput),properties=request.properties as JsonObject;properties.operation={const:operation.id};properties.input=operation.input;
 if(operation.kind==='command')(request.required as string[]).push('commandId');else delete properties.commandId;
 return[{id:`${operation.id}.input`,version:operation.schemaVersion,document:{$id:`gateway.${operation.id}.input@${operation.schemaVersion}`,...request}},{id:`${operation.id}.output`,version:operation.schemaVersion,document:{$id:`gateway.${operation.id}.output@${operation.schemaVersion}`,...gatewayEnvelope(operation.output)}}];
}
export function gatewayPublicReadSchemas(read:GatewayPublicRead):GatewaySchemaDocument[]{return[{id:`${read.id}.input`,version:read.schemaVersion,document:{$id:`gateway.${read.id}.input@${read.schemaVersion}`,...read.input}},{id:`${read.id}.output`,version:read.schemaVersion,document:{$id:`gateway.${read.id}.output@${read.schemaVersion}`,...gatewayEnvelope(read.output)}}];}
export function createAgentGateway(options:{store:RuntimeStore;identity:IdentityAccess<RuntimeReadContext>;operations:GatewayOperation[];guides:GatewayGuide[];publicReads?:GatewayPublicRead[];runtimeGuide?:AgentRuntimeGuideProvider;retainedGuides?:GatewayGuide[];retainedSchemas?:GatewaySchemaDocument[]}){
 const operations=new Map<string,GatewayOperation>(),publicReads=new Map<string,GatewayPublicRead>(),documents=new Map<string,{version:number;document:JsonObject}>(),guides=new Map<string,GatewayGuide>();
 const validVersion=(value:number)=>Number.isSafeInteger(value)&&value>=1&&value<=1000000;
 const moduleId=(id:string)=>/^[a-z][a-z0-9_.-]{0,95}$/.test(id);
 for(const operation of options.operations){
  if(!validVersion(operation.schemaVersion)||!moduleId(operation.moduleId)||!/^[a-z][a-z0-9_.-]{1,99}$/.test(operation.id)||operations.has(operation.id)||operation.kind==='query'&&!operation.query||operation.kind==='command'&&(!operation.command||!operation.authorizeReceipt)||!operation.actors.length)throw new Error('Invalid Gateway operation registration');
  operations.set(operation.id,Object.freeze(operation));
  for(const {id,version,document}of gatewayOperationSchemas(operation))documents.set(id,{version,document});
 }
 for(const read of options.publicReads??[]){
  if(!validVersion(read.schemaVersion)||!moduleId(read.moduleId)||!/^[a-z][a-z0-9_.-]{1,99}$/.test(read.id)||operations.has(read.id)||publicReads.has(read.id)||!/^\/v1\/[A-Za-z0-9/_-]+$/.test(read.path)||[...publicReads.values()].some(item=>item.path===read.path))throw new Error('Invalid public read registration');
  publicReads.set(read.id,Object.freeze(read));
  for(const {id,version,document}of gatewayPublicReadSchemas(read))documents.set(id,{version,document});
 }
 const retainedSchemas=new Map<string,{version:number;document:JsonObject}>();
 if((options.retainedSchemas?.length??0)>42)throw new Error('Too many retained exact schemas');
 let retainedSchemaBytes=0;
 for(const row of options.retainedSchemas??[]){const current=documents.get(row.id),key=row.id+':'+row.version;if(!current||!validVersion(row.version)||row.version>=current.version||row.document.$id!==`gateway.${row.id}@${row.version}`||retainedSchemas.has(key))throw new Error('Invalid retained exact schema');retainedSchemaBytes+=Buffer.byteLength(canonicalGatewayDocument(row.document),'utf8');if(retainedSchemaBytes>256*1024)throw new Error('Retained exact schemas exceed the UTF-8 byte budget');retainedSchemas.set(key,{version:row.version,document:structuredClone(row.document)});}
 const retainedGuides=new Map<string,GatewayGuide>();
 const all=[...options.operations,...options.publicReads??[]];
 for(const guide of options.guides){if(guides.has(guide.moduleId)||!validVersion(guide.version)||!moduleId(guide.moduleId)||guide.document.version!==guide.version||!all.some(op=>op.moduleId===guide.moduleId))throw new Error('Invalid Gateway guide registration');guides.set(guide.moduleId,structuredClone(guide));}
 for(const operation of all)if(!guides.has(operation.moduleId))throw new Error('Missing exact Gateway module guide');
 for(const guide of options.retainedGuides??[]){const key=guide.moduleId+':'+guide.version;if(!guides.has(guide.moduleId)||!validVersion(guide.version)||guide.document.version!==guide.version||guides.get(guide.moduleId)!.version===guide.version||retainedGuides.has(key))throw new Error('Invalid retained exact Gateway guide');retainedGuides.set(key,structuredClone(guide));}
 const schemaRef=(id:string,version:number)=>({id,version,path:`/v1/gateway/schemas/${encodeURIComponent(id)}?version=${version}`});
 const guideRef=(id:string)=>{const guide=guides.get(id)!;return {moduleId:id,version:guide.version,path:`/v1/gateway/guides/${id}?version=${guide.version}`};};
 const descriptors=[...options.operations.map(op=>({id:op.id,moduleId:op.moduleId,kind:op.kind,actors:op.actors,description:op.description,http:{method:'POST',path:op.kind==='command'?'/v1/gateway/commands':'/v1/gateway/query'},inputSchema:schemaRef(`${op.id}.input`,op.schemaVersion),outputSchema:schemaRef(`${op.id}.output`,op.schemaVersion),usageGuide:guideRef(op.moduleId)})),...[...publicReads.values()].map(read=>({id:read.id,moduleId:read.moduleId,kind:'query',actors:['public'],description:read.description,http:{method:'GET',path:read.path},inputSchema:schemaRef(`${read.id}.input`,read.schemaVersion),outputSchema:schemaRef(`${read.id}.output`,read.schemaVersion),usageGuide:guideRef(read.moduleId)}))];
 const catalogRevision=`gateway-${hashRuntimeRequest({operations:descriptors,schemas:[...documents].map(([id,entry])=>({id,version:entry.version,digest:hashRuntimeRequest(entry.document)})),guides:[...guides.values()].map(guide=>({moduleId:guide.moduleId,version:guide.version,digest:hashRuntimeRequest(guide.document)}))}).slice(0,24)}`;
 async function publicProjection(ctx:RuntimeReadContext,requests:readonly PublicWorldRequest[]){const results:Record<string,JsonObject>={};for(const r of requests)results[r.id]=await publicReads.get(r.id)!.read(ctx,r.input);return{instanceId:ctx.instanceId,asOf:ctx.now(),results};}
 const worldReader=createPublicWorldReader(options.store,catalogRevision,publicProjection);
 // World artifacts depend on the API/source cut, not rule prose. Runtime stamps are read fresh outside that cache.
 async function currentCatalogState():Promise<JsonObject>{if(!options.runtimeGuide)return{catalogRevision};const runtimeRules=runtimeRuleMetadata(await currentAgentRuntime(options.runtimeGuide));return {catalogRevision:runtimeCatalogRevision(catalogRevision,runtimeRules),runtimeRules};}
 function sceneRequests(input:JsonObject):PublicWorldRequest[]{return[{id:'world.public_rules',input:{worldId:input.worldId!}},{id:'world.public_scene',input:{worldId:input.worldId!,limit:input.limit??50,...(input.cursor===undefined?{}:{cursor:input.cursor})}}];}
 function definition(id:unknown,kind:'query'|'command'){const operation=operations.get(text(id,'operation',1,100));if(!operation||operation.kind!==kind)fail('capability_not_available',404,'Capability is not available');return operation;}
 function parse(raw:unknown,kind:'query'|'command',validate:GatewayValidator){
  const input=object(raw,kind==='command'?['protocolVersion','consumerId','purpose','operation','input','commandId']:['protocolVersion','consumerId','purpose','operation','input']);
  if(input.protocolVersion!==1)fail('unsupported_protocol',400,'Gateway protocol version is not supported');
  text(input.consumerId,'consumerId',1,100);if(!['agent-manual','human-inspect'].includes(input.purpose as string))fail('invalid_request',400,'Invalid purpose');
  const operation=definition(input.operation,kind),payload=input.input;
  if(!validate(operation.input,payload))fail('invalid_request',400,'Input does not match the current exact operation schema');
  return {operation,input,payload:payload as JsonObject};
 }
 async function authenticate(ctx:RuntimeReadContext,bearer:unknown,operation:GatewayOperation,purpose:unknown){
  const principal=await options.identity.authenticate(ctx,bearer,operation.actors.map(actor=>actor==='agent'?'runtime':'owner_session'));
  if(principal.kind==='agent'&&purpose!=='agent-manual'||principal.kind==='owner'&&purpose!=='human-inspect')fail('insufficient_scope',403,'Purpose does not match the authenticated actor');
  return principal;
 }
 const gateway={
  catalogRevision,
  publicPaths:[...publicReads.values()].map(read=>({id:read.id,path:read.path})),
  capabilities(){return {protocolVersion:1,catalogRevision,discovery:{method:'GET',path:'/v1/gateway/discovery'},query:{method:'POST',path:'/v1/gateway/query'},command:{method:'POST',path:'/v1/gateway/commands'},receipt:{method:'POST',path:'/v1/gateway/receipts/query'},modules:[...guides.keys()],manualOnly:true,externalExecution:'host-controlled',ownerBindingRequiredForAgent:false};},
  discovery(){return {protocolVersion:1,catalogRevision,operations:descriptors,modules:[...guides.values()].map(guide=>({moduleId:guide.moduleId,usageGuide:{version:guide.version,path:`/v1/gateway/guides/${guide.moduleId}?version=${guide.version}`}})),schemaDialect:'JSON-Schema-draft-07',coverage:'activated-handlers-only'};},
  schema(id:string,version:unknown){if(typeof version!=='string'||!/^[1-9][0-9]{0,6}$/.test(version))fail('exact_schema_version_required',400,'Request an exact schema version from current discovery');const current=documents.get(id);if(!current)fail('capability_not_available',404,'Schema is not available');const entry=version===String(current.version)?current:retainedSchemas.get(id+':'+version);if(!entry)fail('schema_version_not_available',404,'That schema version is not available; rediscover the current registered version');return {schemaId:id,version:entry.version,document:entry.document,canonicalDocument:canonicalGatewayDocument(entry.document),digest:hashRuntimeRequest(entry.document),digestAlgorithm:'sha256-utf8-hex'};},
  guide(id:string,version:unknown){if(typeof version!=='string'||!/^[1-9][0-9]{0,6}$/.test(version))fail('exact_guide_version_required',400,'Request an exact guide version from current discovery');const current=guides.get(id);if(!current)fail('capability_not_available',404,'Guide is not available');const guide=version===String(current.version)?current:retainedGuides.get(id+':'+version);if(!guide)fail('guide_version_not_available',404,'That guide version is not available; rediscover the current registered version');return {moduleId:id,version:guide.version,document:guide.document,canonicalDocument:canonicalGatewayDocument(guide.document),digest:hashRuntimeRequest(guide.document),digestAlgorithm:'sha256-utf8-hex'};},
  async publicRead(id:string,input:unknown,validate:GatewayValidator,signal?:AbortSignal){const read=publicReads.get(id);if(!read)fail('capability_not_available',404,'Public capability is not available');if(!validate(read.input,input))fail('invalid_request',400,'Query does not match the current public read schema');
   if(worldReader&&(id==='world.public_scene'||id==='world.public_rules')&&publicReads.has('world.public_scene')&&publicReads.has('world.public_rules')){const payload=input as JsonObject,requests=id==='world.public_scene'?sceneRequests(payload):[{id,input:{worldId:payload.worldId!}}];return(await worldReader.read(requests,signal)).results[id]!;}
   return await options.store.read(ctx=>read.read(ctx,input as JsonObject));},
  /** Internal composition only: registered public handlers share one read context; no arbitrary batch HTTP endpoint. */
  async publicReadBundle(requests:readonly {id:string;input:JsonObject}[],validate:GatewayValidator,signal?:AbortSignal){
   if(requests.length<1||requests.length>4||new Set(requests.map(r=>r.id)).size!==requests.length)fail('invalid_request',400,'Use a bounded set of distinct public reads');
   const selected=requests.map(request=>{const read=publicReads.get(request.id);if(!read)fail('capability_not_available',404,'Public capability is not available');if(!validate(read.input,request.input))fail('invalid_request',400,'Query does not match the current public read schema');return{read,input:request.input};});
   if(worldReader&&requests.length===2&&requests[0]!.id==='world.public_rules'&&requests[1]!.id==='world.public_scene'&&requests[0]!.input.worldId===requests[1]!.input.worldId)return worldReader.read(sceneRequests(requests[1]!.input),signal);
   return options.store.read(async ctx=>{const results:Record<string,JsonObject>={};for(const entry of selected)results[entry.read.id]=await entry.read.read(ctx,entry.input);return{instanceId:ctx.instanceId,asOf:ctx.now(),results};});
  },
  closePublicWorldReads(){worldReader?.close();},
  async query(raw:unknown,bearer:unknown,validate:GatewayValidator){const parsed=parse(raw,'query',validate);return await options.store.read(async ctx=>await parsed.operation.query!(ctx,await authenticate(ctx,bearer,parsed.operation,parsed.input.purpose),parsed.payload));},
  async command(raw:unknown,bearer:unknown,validate:GatewayValidator){
   const parsed=parse(raw,'command',validate),commandId=text(parsed.input.commandId,'commandId',8,100);
   return await options.store.transaction(async ctx=>{const principal=await authenticate(ctx,bearer,parsed.operation,parsed.input.purpose);if(principal.kind==='agent'&&!AUTONOMOUS_WORLD_ACTIONS.includes(parsed.operation.id))fail('world_action_not_allowed',403,'This registered command has no explicit autonomous world permission');const key:CommandKey={domain:parsed.operation.moduleId,action:parsed.operation.id,commandId,principal:{kind:principal.kind,id:principal.kind==='agent'?principal.agentId:principal.ownerId},recoveryEpoch:ctx.recoveryEpoch};return await parsed.operation.command!(ctx,principal,key,parsed.payload);});
  },
  async receipt(raw:unknown,bearer:unknown){
   const input=object(raw,['protocolVersion','consumerId','purpose','operation','commandId']);if(input.protocolVersion!==1)fail('unsupported_protocol',400,'Gateway protocol version is not supported');text(input.consumerId,'consumerId',1,100);
   const operation=definition(input.operation,'command'),commandId=text(input.commandId,'commandId',8,100);
   return await options.store.read(async ctx=>{const principal=await authenticate(ctx,bearer,operation,input.purpose),key:CommandKey={domain:operation.moduleId,action:operation.id,commandId,principal:{kind:principal.kind,id:principal.kind==='agent'?principal.agentId:principal.ownerId},recoveryEpoch:ctx.recoveryEpoch},receipt=await ctx.commands.get(key);
    if(!receipt)fail('target_not_accessible',404,'Receipt is not accessible');await operation.authorizeReceipt!(ctx,principal,receipt);return receipt;});
  },
 };
 return {...gateway,currentCatalogState,async currentCapabilities(){return {...gateway.capabilities(),...await currentCatalogState()};},async currentDiscovery(){return {...gateway.discovery(),...await currentCatalogState()};},async currentGuide(id:string,version:unknown){const exact=gateway.guide(id,version);return {...exact,...(options.runtimeGuide&&String(guides.get(id)?.version)===String(version)?await currentCatalogState():{})};}};
}
export type AgentGateway=ReturnType<typeof createAgentGateway>;
