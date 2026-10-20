import type {CommandKey,CommandReceipt,RuntimeReadContext,RuntimeStore,RuntimeTransaction} from '../contracts/runtime-store.ts';
import type {JsonObject,JsonValue} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {fail,object,text} from '../domains/common/errors.ts';
import {hashRuntimeRequest} from '../domains/runtime/command.ts';
export interface GatewayOperation {
 id:string;moduleId:string;kind:'query'|'command';actors:('agent'|'owner')[];description:string;
 input:JsonObject;output:JsonObject;
 query?:(ctx:RuntimeReadContext,principal:Principal,input:JsonObject)=>Promise<JsonObject>;
 command?:(ctx:RuntimeTransaction,principal:Principal,key:CommandKey,input:JsonObject)=>Promise<CommandReceipt>;
 authorizeReceipt?:(ctx:RuntimeReadContext,principal:Principal,receipt:CommandReceipt)=>Promise<void>;
}
export interface GatewayGuide {moduleId:string;version:number;document:JsonObject}
export interface GatewayPublicRead {id:string;moduleId:string;path:string;description:string;input:JsonObject;output:JsonObject;read:(ctx:RuntimeReadContext,input:JsonObject)=>Promise<JsonObject>}
export type GatewayValidator=(schema:JsonObject,input:unknown)=>boolean;
export function canonicalGatewayDocument(value:JsonValue):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalGatewayDocument).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalGatewayDocument(value[key]!)).join(',')+'}';
}
export const gatewayBaseInput:JsonObject={type:'object',additionalProperties:false,required:['protocolVersion','consumerId','purpose','operation','input'],properties:{protocolVersion:{const:1},consumerId:{type:'string',minLength:1,maxLength:100},purpose:{enum:['agent-manual','human-inspect']},operation:{type:'string',minLength:1,maxLength:100},input:{type:'object'},commandId:{type:'string',minLength:8,maxLength:100}}};
export function gatewayEnvelope(data:JsonObject):JsonObject{return {type:'object',additionalProperties:false,required:['protocolVersion','requestId','instanceId','serverTime','data'],properties:{protocolVersion:{const:1},requestId:{type:'string'},instanceId:{type:'string'},serverTime:{type:'integer'},data}};}
export function createAgentGateway(options:{store:RuntimeStore;identity:IdentityAccess<RuntimeReadContext>;operations:GatewayOperation[];guides:GatewayGuide[];publicReads?:GatewayPublicRead[]}){
 const operations=new Map<string,GatewayOperation>(),publicReads=new Map<string,GatewayPublicRead>(),documents=new Map<string,JsonObject>(),guides=new Map<string,GatewayGuide>();
 for(const operation of options.operations){
  if(!/^[a-z][a-z0-9_.-]{1,99}$/.test(operation.id)||operations.has(operation.id)||operation.kind==='query'&&!operation.query||operation.kind==='command'&&(!operation.command||!operation.authorizeReceipt)||!operation.actors.length)throw new Error('Invalid Gateway operation registration');
  operations.set(operation.id,Object.freeze(operation));
  const request=structuredClone(gatewayBaseInput),properties=request.properties as JsonObject;
  properties.operation={const:operation.id};properties.input=operation.input;
  if(operation.kind==='command')(request.required as string[]).push('commandId');else delete properties.commandId;
  documents.set(`${operation.id}.input`,{$id:`gateway.${operation.id}.input@1`,...request});
  documents.set(`${operation.id}.output`,{$id:`gateway.${operation.id}.output@1`,...gatewayEnvelope(operation.output)});
 }
 for(const read of options.publicReads??[]){if(!/^[a-z][a-z0-9_.-]{1,99}$/.test(read.id)||operations.has(read.id)||publicReads.has(read.id)||!/^\/v1\/world\/[a-z_-]+$/.test(read.path))throw new Error('Invalid public read registration');publicReads.set(read.id,Object.freeze(read));documents.set(`${read.id}.input`,{$id:`gateway.${read.id}.input@1`,...read.input});documents.set(`${read.id}.output`,{$id:`gateway.${read.id}.output@1`,...gatewayEnvelope(read.output)});}
 const all=[...options.operations,...options.publicReads??[]];
 for(const guide of options.guides){if(guides.has(guide.moduleId)||guide.version!==1||!all.some(op=>op.moduleId===guide.moduleId))throw new Error('Invalid Gateway guide registration');guides.set(guide.moduleId,structuredClone(guide));}
 for(const operation of all)if(!guides.has(operation.moduleId))throw new Error('Missing exact Gateway module guide');
 const schemaRef=(id:string)=>({id,version:1,path:`/v1/gateway/schemas/${encodeURIComponent(id)}?version=1`});
 const descriptors=[...options.operations.map(op=>({id:op.id,moduleId:op.moduleId,kind:op.kind,actors:op.actors,description:op.description,http:{method:'POST',path:op.kind==='command'?'/v1/gateway/commands':'/v1/gateway/query'},inputSchema:schemaRef(`${op.id}.input`),outputSchema:schemaRef(`${op.id}.output`),usageGuide:{moduleId:op.moduleId,version:1,path:`/v1/gateway/guides/${op.moduleId}?version=1`}})),...[...publicReads.values()].map(read=>({id:read.id,moduleId:read.moduleId,kind:'query',actors:['public'],description:read.description,http:{method:'GET',path:read.path},inputSchema:schemaRef(`${read.id}.input`),outputSchema:schemaRef(`${read.id}.output`),usageGuide:{moduleId:read.moduleId,version:1,path:`/v1/gateway/guides/${read.moduleId}?version=1`}}))];
 const catalogRevision=`gateway-${hashRuntimeRequest({operations:descriptors,schemas:[...documents].map(([id,document])=>({id,digest:hashRuntimeRequest(document)})),guides:[...guides.values()].map(guide=>({moduleId:guide.moduleId,version:guide.version,digest:hashRuntimeRequest(guide.document)}))}).slice(0,24)}`;
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
 return {
  catalogRevision,
  publicPaths:[...publicReads.values()].map(read=>({id:read.id,path:read.path})),
  capabilities(){return {protocolVersion:1,catalogRevision,discovery:{method:'GET',path:'/v1/gateway/discovery'},query:{method:'POST',path:'/v1/gateway/query'},command:{method:'POST',path:'/v1/gateway/commands'},receipt:{method:'POST',path:'/v1/gateway/receipts/query'},modules:[...guides.keys()],manualOnly:true,externalExecution:'host-controlled',ownerBindingRequiredForAgent:false};},
  discovery(){return {protocolVersion:1,catalogRevision,operations:descriptors,modules:[...guides.values()].map(guide=>({moduleId:guide.moduleId,usageGuide:{version:guide.version,path:`/v1/gateway/guides/${guide.moduleId}?version=${guide.version}`}})),schemaDialect:'JSON-Schema-draft-07',coverage:'activated-handlers-only'};},
  schema(id:string,version:unknown){if(version!=='1')fail('unsupported_schema_version',400,'Request an exact supported schema version');const document=documents.get(id);if(!document)fail('capability_not_available',404,'Schema is not available');return {schemaId:id,version:1,document,canonicalDocument:canonicalGatewayDocument(document),digest:hashRuntimeRequest(document),digestAlgorithm:'sha256-utf8-hex'};},
  guide(id:string,version:unknown){if(version!=='1')fail('unsupported_guide_version',400,'Request an exact supported guide version');const guide=guides.get(id);if(!guide)fail('capability_not_available',404,'Guide is not available');return {moduleId:id,version:1,document:guide.document,canonicalDocument:canonicalGatewayDocument(guide.document),digest:hashRuntimeRequest(guide.document),digestAlgorithm:'sha256-utf8-hex'};},
  async publicRead(id:string,input:unknown,validate:GatewayValidator){const read=publicReads.get(id);if(!read)fail('capability_not_available',404,'Public capability is not available');if(!validate(read.input,input))fail('invalid_request',400,'Query does not match the current public read schema');return await options.store.read(ctx=>read.read(ctx,input as JsonObject));},
  async query(raw:unknown,bearer:unknown,validate:GatewayValidator){const parsed=parse(raw,'query',validate);return await options.store.read(async ctx=>await parsed.operation.query!(ctx,await authenticate(ctx,bearer,parsed.operation,parsed.input.purpose),parsed.payload));},
  async command(raw:unknown,bearer:unknown,validate:GatewayValidator){
   const parsed=parse(raw,'command',validate),commandId=text(parsed.input.commandId,'commandId',8,100);
   return await options.store.transaction(async ctx=>{const principal=await authenticate(ctx,bearer,parsed.operation,parsed.input.purpose),key:CommandKey={domain:parsed.operation.moduleId,action:parsed.operation.id,commandId,principal:{kind:principal.kind,id:principal.kind==='agent'?principal.agentId:principal.ownerId},recoveryEpoch:ctx.recoveryEpoch};return await parsed.operation.command!(ctx,principal,key,parsed.payload);});
  },
  async receipt(raw:unknown,bearer:unknown){
   const input=object(raw,['protocolVersion','consumerId','purpose','operation','commandId']);if(input.protocolVersion!==1)fail('unsupported_protocol',400,'Gateway protocol version is not supported');text(input.consumerId,'consumerId',1,100);
   const operation=definition(input.operation,'command'),commandId=text(input.commandId,'commandId',8,100);
   return await options.store.read(async ctx=>{const principal=await authenticate(ctx,bearer,operation,input.purpose),key:CommandKey={domain:operation.moduleId,action:operation.id,commandId,principal:{kind:principal.kind,id:principal.kind==='agent'?principal.agentId:principal.ownerId},recoveryEpoch:ctx.recoveryEpoch},receipt=await ctx.commands.get(key);
    if(!receipt)fail('target_not_accessible',404,'Receipt is not accessible');await operation.authorizeReceipt!(ctx,principal,receipt);return receipt;});
  },
 };
}
export type AgentGateway=ReturnType<typeof createAgentGateway>;
