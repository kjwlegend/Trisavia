import {randomBytes,randomUUID} from 'node:crypto';
import {lstat,mkdir,realpath,rename,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export type Json=Record<string,any>;
type Method='GET'|'POST'|'PUT';
export type Api=(method:Method,path:string,body?:Json,token?:string)=>Promise<{status:number;body:Json}>;
type Injector={inject(options:any):Promise<{statusCode:number;json():Json}>;close():Promise<unknown>};
export const credential=()=>`${randomUUID()}.${randomBytes(32).toString('base64url')}`;
export const operationId=()=>randomUUID();
class FixtureError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code;}}
const fail=(code:string):never=>{throw new FixtureError(code);};

export function injectApi(app:Injector,remember?:(command:Json)=>Promise<void>):Api{
 return async(method,path,body,token)=>{
  const command:Json={method,path,...(body?{body}:{}),...(token?{token}:{}),status:'pending'};
  await remember?.(command);
  const response=await app.inject({method,url:`/v1${path}`,...(body?{payload:body}:{}),...(token?{headers:{authorization:`Bearer ${token}`}}:{})});
  let result:Json;try{result=response.json();}catch{fail('non_json_response');}
  command.status='read';command.httpStatus=response.statusCode;command.result=result!;await remember?.(command);
  return{status:response.statusCode,body:result!};
 };
}
export async function ok(api:Api,method:Method,path:string,body?:Json,token?:string){
 const result=await api(method,path,body,token);
 if(result.status!==200)fail(/^[a-z0-9_]{1,80}$/u.test(result.body.error?.code??'')?result.body.error.code:'unexpected_http_status');
 return result.body;
}
export function registrationCommand(inviteToken?:string){
 return{operationId:operationId(),attemptId:randomUUID(),runtimeToken:credential(),continuationToken:credential(),...(inviteToken?{inviteToken}:{})};
}
export async function ownerFixture(api:Api,label:string,prepare?:(owner:Json)=>Promise<void>){
 const attemptId=randomUUID(),browserToken=credential(),sessionToken=credential();
 const username=`QA_Manager_${label}_${randomBytes(4).toString('hex')}`;
 const owner={label,ownerId:attemptId,username,email:`${username.toLowerCase()}@example.test`,password:`Synthetic-only-${randomUUID()}!`,browserToken,sessionToken};
 await prepare?.(owner);
 await ok(api,'POST','/owner/registration-attempts',{operationId:operationId(),attemptId,browserToken,username,email:owner.email});
 const sendOperationId=operationId();
 await ok(api,'POST',`/owner/registration-attempts/${attemptId}/email-challenges`,{operationId:sendOperationId},browserToken);
 await ok(api,'POST',`/owner/registration-attempts/${attemptId}/email-verifications`,{operationId:operationId(),sendOperationId,code:'1234'},browserToken);
 const result=await ok(api,'POST','/owner/accounts',{operationId:operationId(),attemptId,password:owner.password,sessionToken},browserToken);
 if(result.ownerId!==attemptId||result.emailVerified!==false)fail('unexpected_owner_result');
 return owner;
}
export async function agentFixture(api:Api,owner:Json,name:string,color:string,prepare?:(agent:Json)=>Promise<void>){
 const inviteToken=credential(),command=registrationCommand(inviteToken);
 const agent:Json={name,color,...command};await prepare?.(agent);
 await ok(api,'POST','/owner/agent-invites',{operationId:operationId(),inviteToken},owner.sessionToken);
 const registration=await ok(api,'POST','/registrations',command);agent.agentId=registration.agentId;agent.ownerId=registration.ownerId;
 if(registration.ownerId!==owner.ownerId)fail('unexpected_agent_binding');
 // Registration itself must already be public; naming the QA identity is a later owner save.
 const initial=await ok(api,'GET',`/public/agents/${agent.agentId}`);
 if(initial.profile?.displayName!==`Agent ${agent.agentId.slice(0,8)}`||initial.profile?.avatar?.color!=='olive')fail('unexpected_default_profile');
 const profile=await ok(api,'GET',`/agents/${agent.agentId}/profile`,undefined,owner.sessionToken);
 await ok(api,'PUT',`/agents/${agent.agentId}/profile`,{operationId:operationId(),expectedVersion:profile.version,expectedPolicyVersion:profile.policyVersion,
  fields:{displayName:name,avatar:{template:'basic',color},bio:'仅供隔离管理验证，不是真实用户。',interests:['合成测试']}},owner.sessionToken);
 const visible=await ok(api,'GET',`/public/agents/${agent.agentId}`);
 if(visible.profile?.displayName!==name||visible.profile?.avatar?.color!==color)fail('saved_profile_not_public');
 return agent;
}

async function main(){
 const args:Record<string,string>={};
 for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!key||!value)return fail('invalid_arguments');
  if(!['--candidate','--out','--connection','--identity'].includes(key)||value.startsWith('--')||args[key])return fail('invalid_arguments');
  args[key]=value;
 }
 const candidateArgument=args['--candidate'],outputArgument=args['--out'],connectionFile=args['--connection'],identityPath=args['--identity'];
 if(!candidateArgument||!outputArgument||!connectionFile||!identityPath||![candidateArgument,outputArgument,connectionFile,identityPath].every(isAbsolute))return fail('absolute_candidate_output_connection_and_identity_required');
 if(Number(process.versions.node.split('.')[0])!==24)fail('node_24_required');
 const candidate=await realpath(candidateArgument),requested=resolve(outputArgument),parent=await realpath(dirname(requested));
 if(parent!==dirname(requested)||(await lstat(candidate)).isDirectory()!==true)fail('unsafe_directory');
 const out=join(parent,basename(requested));
 try{await mkdir(out,{mode:0o700});}catch{fail('new_output_directory_required');}
 const fixturePath=join(out,'fixture.private.json'),previousMask=process.umask(0o077);
 const state:Json={format:'connet-agent-manager-qa-v1',purpose:'isolated-synthetic-ui-login',candidatePath:candidate,phase:'preparing',owners:[],commands:[]};
 let app:Injector|undefined;
 async function save(){
  const directory=await lstat(out);if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o777)!==0o700)fail('unsafe_output_permissions');
  try{const existing=await lstat(fixturePath);if(!existing.isFile()||existing.isSymbolicLink()||(existing.mode&0o777)!==0o600)fail('unsafe_fixture_file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const temporary=join(out,`.fixture-${randomUUID()}.tmp`);await writeFile(temporary,`${JSON.stringify(state,null,2)}\n`,{flag:'wx',mode:0o600});await rename(temporary,fixturePath);
 }
 try{
  await save();
  const {loadBackendConfig}=await import(pathToFileURL(join(candidate,'apps/platform/configuration/backend-config.ts')).href);
  const {buildApp}=await import(pathToFileURL(join(candidate,'apps/platform/app.ts')).href);
  // Explicit configuration never inherits a user's database, identity or Resend secrets.
  const config=loadBackendConfig({M1_EMAIL_MODE:'experience',M1_POSTGRES_CONNECTION_FILE:connectionFile,M1_IDENTITY_PATH:identityPath},out);
  Object.assign(state,{connectionFile,identityPath:config.identityPath,instanceId:config.instanceId,recoveryEpoch:config.recoveryEpoch});await save();
  const activeApp:Injector=await buildApp(config);app=activeApp;
  const api=injectApi(activeApp,async command=>{if(!state.commands.includes(command))state.commands.push(command);await save();});
  const capabilities=await ok(api,'GET','/capabilities');if(capabilities.emailMode!=='experience'||capabilities.ownerEmailVerification!==true)fail('experience_candidate_required');
  for(const label of ['A','B','Empty']){
   const owner=await ownerFixture(api,label,async value=>{state.owners.push({...value,agents:[]});await save();});
   const saved=state.owners.find((entry:Json)=>entry.ownerId===owner.ownerId);
   for(const [name,color]of label==='A'?[['管理测试甲 <A & B>','blue'],['管理测试乙','coral']]:label==='B'?[['管理受限丙','cream']]:[]){
    const agent=await agentFixture(api,owner,name!,color!,async value=>{saved.agents.push(value);await save();});await save();
    if(label==='B'){
     const profile=await ok(api,'GET',`/agents/${agent.agentId}/profile`,undefined,owner.sessionToken);
     await ok(api,'PUT',`/owner/agents/${agent.agentId}/profile-policy`,{operationId:operationId(),expectedVersion:profile.version,expectedPolicyVersion:profile.policyVersion,mode:'proposal_required',lockedFields:['displayName','bio']},owner.sessionToken);
     const member=await ok(api,'GET',`/agents/${agent.agentId}/membership`,undefined,agent.runtimeToken);
     await ok(api,'POST',`/agents/${agent.agentId}/membership/leave`,{operationId:operationId(),expectedVersion:member.version},agent.runtimeToken);
     const left=await ok(api,'GET',`/agents/${agent.agentId}/membership`,undefined,owner.sessionToken);
     await ok(api,'PUT',`/owner/agents/${agent.agentId}/participation`,{operationId:operationId(),expectedVersion:left.version,paused:true},owner.sessionToken);
     agent.scenario='historical_left_with_public_snapshot_proposal_locked_and_paused';
     if((await api('GET',`/public/agents/${agent.agentId}`)).status!==404)fail('historical_left_still_public');
    }else{
     const self=await ok(api,'GET','/agent/self',undefined,agent.runtimeToken);
     if(self.profile?.mode!=='agent_autonomous'||self.profile?.lockedFields?.length!==0||self.membership?.ownerPaused!==false||self.membership?.state!=='joined')fail('qa_direct_agent_not_editable');
     agent.scenario='direct_editable_public';
    }
    agent.worldAccess=await ok(api,'GET',`/agents/${agent.agentId}/world-access`,undefined,owner.sessionToken);
    if(agent.worldAccess.intervalSeconds!==null||agent.worldAccess.version!==1)fail('unexpected_initial_world_access');await save();
   }
   const list=await ok(api,'GET','/owner/agents',undefined,owner.sessionToken);
   if(list.agents.length!==saved.agents.length||saved.agents.some((agent:Json)=>!list.agents.some((row:Json)=>row.agentId===agent.agentId)))fail('unexpected_owner_list');
  }
  state.phase='ready';await save();await activeApp.close();app=undefined;
  process.stdout.write(`${JSON.stringify({fixturePath,owners:state.owners.map((owner:Json)=>({label:owner.label,ownerId:owner.ownerId,agentIds:owner.agents.map((agent:Json)=>agent.agentId)}))})}\n`);
 }finally{await app?.close();process.umask(previousMask);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 void main().catch(error=>{process.stderr.write(`fixture_failed:${error instanceof FixtureError?error.code:'unexpected_failure'}\n`);process.exitCode=1;});
}
