// One manual HUD read at a time per surface. No timers, credentials or reader-state writes.
export const WORLD_VIEWS={holdings:{channel:'inventory',categoryId:'holdings'},items:{channel:'world',categoryId:'items'},messages:{channel:'inbox',categoryId:'messages'},notifications:{channel:'inbox',categoryId:'notifications'},announcements:{channel:'world',categoryId:'announcements'},events:{channel:'world',categoryId:'events'}};
const clone=value=>structuredClone(value),refKey=ref=>JSON.stringify([ref?.moduleId,ref?.type,ref?.id]);
const problem=code=>Object.assign(new Error(code),{code});
const structural=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(structural(item))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(structural(value[key]))])):value);
const blank=()=>({phase:'idle',records:[],complete:false,nextPageToken:null,errorCode:'',permissionVersion:'',instanceId:''});
export function readPhase(error){
  if(error?.status===401||['authentication_required','session_expired'].includes(error?.code))return 'session';
  if(['content_changed','page_expired','read_scope_changed'].includes(error?.code))return 'resync';
  if(error?.status===403||['insufficient_scope','target_not_accessible'].includes(error?.code))return 'denied';
  if(error?.code==='agent_required')return 'no_agent';
  if(error?.code==='channel_not_enabled')return 'not_enabled';
  if(error?.code==='source_unavailable')return 'unavailable';
  return 'error';
}
export function createWorldReadProvider(session){
  let identity=session.snapshot().observationRevision,revision=0,disposed=false,metadata=null;
  const empty=key=>({...blank(),phase:!session.snapshot().authenticated?'session':WORLD_VIEWS[key].channel!=='world'&&!session.snapshot().selectedAgentId?'no_agent':'idle'});
  const views=Object.fromEntries(Object.keys(WORLD_VIEWS).map(key=>[key,empty(key)])),epochs=Object.fromEntries(Object.keys(WORLD_VIEWS).map(key=>[key,0])),listeners=new Set(),requests=new Map();
  const snapshot=key=>clone(views[key]),emit=key=>{for(const listener of listeners)listener(key,snapshot(key));};
  function invalidate(){revision++;metadata=null;for(const request of requests.values())request.abort();requests.clear();for(const key of Object.keys(views)){views[key]=empty(key);emit(key);}}
  const stop=session.subscribe(state=>{if(identity===state.observationRevision)return;identity=state.observationRevision;invalidate();});
  const invoke=(op,input,signal)=>{if(disposed||signal?.aborted)throw new DOMException('Read cancelled','AbortError');return session.readPerception(op,input,{signal});};
  const unwrap=result=>{if(result?.protocolVersion!==1||!result.instanceId||!result.permissionVersion||!result.data)throw problem('response_unknown');return result;};
  async function document(ref,kind,signal){
    const result=unwrap(await invoke(kind,kind==='schema'?{schemaId:ref.id,version:ref.version}:{moduleId:ref.moduleId,version:ref.version},signal)).data;
    if(result.version!==ref.version||!result.document||typeof result.canonicalDocument!=='string'||structural(JSON.parse(result.canonicalDocument))!==structural(result.document))throw problem('response_unknown');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.canonicalDocument));
    if([...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')!==result.digest)throw problem('response_unknown');
    return result.document;
  }
  async function prepare(signal){
    const generation=revision;
    const capabilities=await invoke('capabilities',{},signal),cap=capabilities?.perceptionApi;
    if(disposed||generation!==revision)throw new DOMException('Context changed','AbortError');
    if(capabilities?.perception!==true||cap?.protocolVersion!==1)throw problem('channel_not_enabled');
    if(!session.snapshot().authenticated)throw problem('authentication_required');
    const stamp=JSON.stringify([capabilities.instanceId,cap.catalogRevision,cap.skillCatalogRevision]);
    const documents=metadata?.stamp===stamp?metadata.documents:new Map();
    // Source availability is live even when immutable document versions are unchanged.
      const catalog={worlds:[],modules:[],types:[],sources:[],categories:[],operations:[],skills:[]};let token=null,complete=false;
      const seen=new Set();
      for(let page=0;page<20&&!complete;page++){
        const envelope=unwrap(await invoke('discovery',token?{pageToken:token}:{},signal)),data=envelope.data;
        if(envelope.instanceId!==capabilities.instanceId||data.catalogRevision!==cap.catalogRevision||data.skillCatalogRevision!==cap.skillCatalogRevision)throw problem('read_scope_changed');
        for(const name of Object.keys(catalog)){if(!Array.isArray(data[name]))throw problem('response_unknown');catalog[name].push(...data[name]);}
        complete=data.complete===true;token=data.nextPageToken;
        if(!complete&&(typeof token!=='string'||seen.has(token)))throw problem('response_unknown');seen.add(token);
      }
      if(!complete)throw problem('response_unknown');
      const value={stamp,cap,capabilities,catalog,documents,instanceId:capabilities.instanceId};
      if(generation!==revision)throw new DOMException('Context changed','AbortError');metadata=value;return value;
  }
  async function ready(key,operation,signal){
    const meta=await prepare(signal),view=WORLD_VIEWS[key];
    if(view.channel!=='world'){
      const observation=meta.cap.ownerObservation;
      if(!observation||observation.agentRefRequired!==true||(view.channel==='inventory'?observation.inventory!==true:observation.inbox!=='source-authorized')||(key==='messages'&&observation.messages!=='source-authorized'))throw problem('channel_not_enabled');
      if(!session.snapshot().selectedAgentId)throw problem('agent_required');
    }
    const category=meta.catalog.categories.find(entry=>entry.categoryId===view.categoryId&&entry.channel===view.channel);
    if(!category)throw problem('channel_not_enabled');
    const sources=category.sourceIds.map(id=>meta.catalog.sources.find(source=>source.sourceId===id));
    if(sources.some(source=>!source||source.state==='not_enabled'))throw problem('channel_not_enabled');
    if(sources.some(source=>source.state!=='enabled'))throw problem('source_unavailable');
    const declaration=meta.catalog.operations.find(entry=>entry.id===operation);
    if(!declaration||declaration.method!=='POST'||declaration.path!==`/v1/perception/${operation}`)throw problem('channel_not_enabled');
    const moduleId=view.channel==='inventory'?'inventory':view.channel==='inbox'?'mailbox':view.categoryId==='items'?'items':'world';
    await readDeclaration(meta,declaration,moduleId,signal);
    const input=meta.documents.get(JSON.stringify(['schema',declaration.inputSchema]));
    if(view.channel!=='world'&&!input?.properties?.agentRef)throw problem('channel_not_enabled');
    return meta;
  }
  async function readDeclaration(meta,declaration,moduleId,signal){
    const guide=meta.catalog.modules.find(entry=>entry.moduleId===moduleId)?.usageGuide;
    if(!guide)throw problem('response_unknown');
    const required=[['schema',declaration.inputSchema],['schema',declaration.outputSchema],['guide',guide]];
    for(const [kind,ref]of required){
      if(!ref||!Number.isSafeInteger(ref.version))throw problem('response_unknown');
      const id=JSON.stringify([kind,ref]);if(!meta.documents.has(id))meta.documents.set(id,await document(ref,kind,signal));
    }
  }
  async function prepareOperation(operation,moduleId,{signal}={}){
    const meta=await prepare(signal),declaration=meta.catalog.operations.find(entry=>entry.id===operation);
    if(!declaration)throw problem('channel_not_enabled');
    await readDeclaration(meta,declaration,moduleId,signal);return meta;
  }
  async function load(key,{more=false}={}){
    if(disposed||!WORLD_VIEWS[key])return;
    const previous=views[key];
    if(more&&(!previous.nextPageToken||previous.complete))return;
    requests.get(key)?.abort();const request=new AbortController();requests.set(key,request);const generation=revision,scopeEpoch=epochs[key];
    views[key]={...(more?previous:blank()),phase:'loading',loadingMore:more};emit(key);
    const current=()=>!disposed&&generation===revision&&scopeEpoch===epochs[key]&&requests.get(key)===request;
    try{
      const meta=await ready(key,'list',request.signal);if(!current())return;
      const result=unwrap(await invoke('list',{...WORLD_VIEWS[key],...(more?{pageToken:previous.nextPageToken}:{})},request.signal)),data=result.data;
      if(result.instanceId!==meta.instanceId||data.channel!==WORLD_VIEWS[key].channel||data.categoryId!==WORLD_VIEWS[key].categoryId||!Array.isArray(data.records)||typeof data.complete!=='boolean'||(!data.complete&&typeof data.nextPageToken!=='string'))throw problem('response_unknown');
      if(more&&(result.permissionVersion!==previous.permissionVersion||result.instanceId!==previous.instanceId))throw problem('read_scope_changed');
      const records=more?[...previous.records]:[],seen=new Set(records.map(record=>refKey(record.ref)));
      for(const record of data.records){if(!record.ref||!Number.isSafeInteger(record.version)||typeof record.summary?.title!=='string'||seen.has(refKey(record.ref)))throw problem('response_unknown');seen.add(refKey(record.ref));records.push(record);}
      if(!current())return;
      views[key]={phase:'ready',records,complete:data.complete,nextPageToken:data.nextPageToken??null,errorCode:'',permissionVersion:result.permissionVersion,instanceId:result.instanceId};emit(key);
    }catch(error){
      if(!current()||error.name==='AbortError')return;
      if(reject(key,error))return;
      const phase=readPhase(error),preserve=more&&['error','unavailable'].includes(phase)&&previous.records.length>0;
      views[key]={...(preserve?previous:blank()),phase:preserve?'partial':phase,errorCode:error.code||'response_unknown',complete:false};emit(key);
    }finally{if(requests.get(key)===request)requests.delete(key);}
  }
  async function readDetail(key,record,{signal}={}){
    const generation=revision,scopeEpoch=epochs[key],meta=await ready(key,'detail',signal),view=WORLD_VIEWS[key];
    if(disposed||generation!==revision||scopeEpoch!==epochs[key]||signal?.aborted)throw new DOMException('Context changed','AbortError');
    let token=null,text='',first=null,complete=false,offset=0,expectedVersion=record.version;const seen=new Set();
    for(let index=0;index<2049&&!complete;index++){
      const result=unwrap(await invoke('detail',{channel:view.channel,ref:record.ref,...(Number.isSafeInteger(expectedVersion)?{knownVersion:expectedVersion}:{}),...(token?{contentToken:token}:{})},signal)),data=result.data;
      if(disposed||generation!==revision||scopeEpoch!==epochs[key])throw new DOMException('Context changed','AbortError');
      if(result.instanceId!==meta.instanceId||refKey(data.ref)!==refKey(record.ref)||!Number.isSafeInteger(data.version)||(expectedVersion!==undefined&&data.version!==expectedVersion)||typeof data.content?.text!=='string'||data.segment?.unit!=='utf16-code-units'||data.segment.start!==offset||data.segment.end!==offset+data.content.text.length||!Number.isSafeInteger(data.segment.total)||data.segment.total>1048576)throw problem('content_changed');
      expectedVersion??=data.version;
      if(first&&(result.permissionVersion!==first.permissionVersion||data.segment.total!==first.data.segment.total||data.readSessionId!==first.data.readSessionId))throw problem('read_scope_changed');
      first??=result;text+=data.content.text;offset=data.segment.end;complete=data.contentComplete===true;token=data.nextContentToken;
      if(complete){if(offset!==data.segment.total||token!==null)throw problem('response_unknown');return{...data,content:{...data.content,text},permissionVersion:result.permissionVersion};}
      if(typeof token!=='string'||seen.has(token)||offset>=data.segment.total||!data.content.text.length)throw problem('response_unknown');seen.add(token);
    }
    throw problem('response_unknown');
  }
  async function detail(key,record,options={}){
    const generation=revision,scopeEpoch=epochs[key];
    try{const result=await readDetail(key,record,options);if(disposed||generation!==revision||scopeEpoch!==epochs[key]||options.signal?.aborted)throw new DOMException('Context changed','AbortError');if(key==='messages'){views[key]={...views[key],records:views[key].records.map(value=>refKey(value.ref)===refKey(record.ref)?{...value,summary:{...value.summary,sender:clone(result.content.sender??null)}}:value)};emit(key);}return result;}
    catch(error){if(!disposed&&generation===revision&&scopeEpoch===epochs[key]&&error.name!=='AbortError')reject(key,error);throw error;}
  }
  // A failed private read can mean the binding or whole source audience was revoked.
  // Clear both private surfaces before any retry; never retain other cached titles.
  function reject(key,error){
    const phase=readPhase(error);if(!['session','denied','resync'].includes(phase))return false;
    const keys=phase==='session'?Object.keys(views):WORLD_VIEWS[key].channel!=='world'?['holdings','messages','notifications']:[key];
    for(const scope of keys){epochs[scope]++;requests.get(scope)?.abort();requests.delete(scope);views[scope]={...blank(),phase,errorCode:error.code||'response_unknown'};emit(scope);}
    return true;
  }
  function cancel(key){const request=requests.get(key);if(!request)return;request.abort();requests.delete(key);views[key]=views[key].records.length?{...views[key],phase:'ready',loadingMore:false}:empty(key);emit(key);}
  return{snapshot,load,detail,cancel,prepareOperation,invalidatePrivate:error=>reject('holdings',error),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},dispose(){disposed=true;stop();invalidate();listeners.clear();}};
}
