const format='connet-hud-demo-v1',prefix='connet.hud.demo.v1:';
const channels=['private','world'],categories=['all','artwork','item'],readFilters=['all','unread','read'];
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const bounded=(value,max=160)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const reference=value=>bounded(value)&&value.length>0;
const position=value=>Number.isFinite(value)&&value>=0?Math.min(value,1000000):0;
const ids=value=>Array.isArray(value)?[...new Set(value.filter(reference))].slice(0,500):[];
const clone=value=>structuredClone(value);

function emptyState(){return{
  inventory:{category:'all',query:'',selectedId:'',scrollTop:0},
  mail:{channel:'private',filters:{private:{read:'all',pending:false},world:{read:'all'}},
    selectedIds:{private:'',world:''},scrollTop:{private:0,world:0},readIds:{private:[],world:[]},hiddenIds:{private:[],world:[]}},
};}
function normalizeScope(value){
  if(!plain(value)||!reference(value.origin)||!reference(value.instanceId)||!reference(value.sourceId)||!reference(value.sourceVersion))return null;
  if(value.kind==='guest'&&value.ownerId===''&&value.agentId==='')return{origin:value.origin,instanceId:value.instanceId,kind:'guest',ownerId:'',agentId:'',sourceId:value.sourceId,sourceVersion:value.sourceVersion};
  if(value.kind!=='owner'||!reference(value.ownerId)||!bounded(value.agentId))return null;
  return{origin:value.origin,instanceId:value.instanceId,kind:'owner',ownerId:value.ownerId,agentId:value.agentId,sourceId:value.sourceId,sourceVersion:value.sourceVersion};
}
function scopeKey(scope){return scope?JSON.stringify([scope.origin,scope.instanceId,scope.kind,scope.ownerId,scope.agentId,scope.sourceId,scope.sourceVersion]):'';}
function readState(value){
  const next=emptyState();if(!plain(value))return next;
  const inventory=value.inventory;
  if(plain(inventory)){
    if(categories.includes(inventory.category))next.inventory.category=inventory.category;
    if(bounded(inventory.query,100))next.inventory.query=inventory.query;
    if(bounded(inventory.selectedId))next.inventory.selectedId=inventory.selectedId;
    next.inventory.scrollTop=position(inventory.scrollTop);
  }
  const mail=value.mail;if(!plain(mail))return next;
  if(channels.includes(mail.channel))next.mail.channel=mail.channel;
  for(const channel of channels){
    const filter=mail.filters?.[channel];
    if(readFilters.includes(filter?.read))next.mail.filters[channel].read=filter.read;
    if(channel==='private'&&typeof filter?.pending==='boolean')next.mail.filters.private.pending=filter.pending;
    if(bounded(mail.selectedIds?.[channel]))next.mail.selectedIds[channel]=mail.selectedIds[channel];
    next.mail.scrollTop[channel]=position(mail.scrollTop?.[channel]);
    next.mail.readIds[channel]=ids(mail.readIds?.[channel]);next.mail.hiddenIds[channel]=ids(mail.hiddenIds?.[channel]);
  }
  return next;
}
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}

// This store owns only human demo-view preferences. It never changes source
// records, account capabilities, business status or an Agent's reading cursor.
export function createLocalHudState({storage=browserStorage()}={}){
  let scope=null,key='',revision=0,state=emptyState(),persistence=storage?'saved':'memory',disposed=false;
  const listeners=new Set();
  const snapshot=()=>({scope:scope?clone(scope):null,revision,state:clone(state),persistence});
  const emit=()=>{for(const listener of listeners)listener(snapshot());};
  function current(lease){return !disposed&&Boolean(key)&&lease?.key===key&&lease.revision===revision;}
  function persist(){
    if(!scope||!storage)return;
    try{storage.setItem(prefix+encodeURIComponent(key),JSON.stringify({format,scope,state}));persistence='saved';}
    catch{persistence='memory';}
  }
  function commit(lease,change){if(!current(lease))return false;change();persist();emit();return true;}
  function setContext(value){
    if(disposed)return;
    const next=normalizeScope(value),nextKey=scopeKey(next);if(nextKey===key)return;
    revision++;scope=next;key=nextKey;state=emptyState();persistence=storage?'saved':'memory';
    if(scope&&storage){try{
      const raw=storage.getItem(prefix+encodeURIComponent(key));
      const saved=raw&&raw.length<=65536?JSON.parse(raw):null;
      if(saved?.format===format&&scopeKey(normalizeScope(saved.scope))===key)state=readState(saved.state);
    }catch{persistence='memory';}}
    emit();
  }
  return{
    setContext,snapshot,lease:()=>({key,revision}),isCurrent:current,
    subscribe(listener){if(disposed)return()=>{};listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    inventory(lease,patch){
      if(!plain(patch)||Object.keys(patch).some(field=>!['category','query','selectedId','scrollTop'].includes(field)))return false;
      if('category'in patch&&!categories.includes(patch.category)||'query'in patch&&!bounded(patch.query,100)||'selectedId'in patch&&!bounded(patch.selectedId)||'scrollTop'in patch&&(!Number.isFinite(patch.scrollTop)||patch.scrollTop<0))return false;
      return commit(lease,()=>{state.inventory={...state.inventory,...patch};state.inventory.scrollTop=position(state.inventory.scrollTop);});
    },
    mailView(lease,patch){
      if(!plain(patch)||Object.keys(patch).some(field=>!['channel','read','pending','selectedId','scrollTop'].includes(field)))return false;
      const channel='channel'in patch?patch.channel:state.mail.channel;if(!channels.includes(channel)||'read'in patch&&!readFilters.includes(patch.read)||'pending'in patch&&(channel!=='private'||typeof patch.pending!=='boolean')||'selectedId'in patch&&!bounded(patch.selectedId)||'scrollTop'in patch&&(!Number.isFinite(patch.scrollTop)||patch.scrollTop<0))return false;
      return commit(lease,()=>{
        state.mail.channel=channel;
        if('read'in patch)state.mail.filters[channel].read=patch.read;
        if('pending'in patch)state.mail.filters.private.pending=patch.pending;
        if('selectedId'in patch)state.mail.selectedIds[channel]=patch.selectedId;
        if('scrollTop'in patch)state.mail.scrollTop[channel]=position(patch.scrollTop);
      });
    },
    markRead(lease,channel,id,value=true){
      if(!channels.includes(channel)||!reference(id)||typeof value!=='boolean')return false;
      return commit(lease,()=>{const values=new Set(state.mail.readIds[channel]);if(value)values.add(id);else values.delete(id);state.mail.readIds[channel]=[...values].slice(-500);});
    },
    hideMessage(lease,channel,id){
      if(!channels.includes(channel)||!reference(id))return false;
      return commit(lease,()=>{state.mail.hiddenIds[channel]=[...new Set([...state.mail.hiddenIds[channel],id])].slice(-500);if(state.mail.selectedIds[channel]===id)state.mail.selectedIds[channel]='';});
    },
    restoreMessage(lease,channel,id){
      if(!channels.includes(channel)||!reference(id))return false;
      return commit(lease,()=>{state.mail.hiddenIds[channel]=state.mail.hiddenIds[channel].filter(value=>value!==id);});
    },
    dispose(){if(disposed)return;disposed=true;revision++;scope=null;key='';state=emptyState();listeners.clear();},
  };
}
