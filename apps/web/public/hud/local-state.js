const format='connet-hud-demo-v1',prefix='connet.hud.demo.v1:';
const channels=['private','world'],categories=['all','artwork','item'],readFilters=['all','unread','read'];
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const bounded=(value,max=160)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const reference=value=>bounded(value)&&value.length>0;
const position=value=>Number.isFinite(value)&&value>=0?Math.min(value,1000000):0;
const ids=value=>Array.isArray(value)?[...new Set(value.filter(reference))].slice(0,500):[];
const clone=value=>structuredClone(value);

function emptyState(){return{
  inventory:{category:'all',query:'',selectedId:'',scrollTop:0,detailScrollTop:0},
  mail:{channel:'private',filters:{private:{read:'all',pending:false},world:{read:'all'}},
    selectedIds:{private:'',world:''},scrollTop:{private:0,world:0},bodyScrollTop:{private:{},world:{}},readIds:{private:[],world:[]},hiddenIds:{private:[],world:[]},undo:{entries:[],expiresAt:0}},
};}
function normalizeScope(value){
  if(!plain(value)||!reference(value.origin)||!reference(value.instanceId)||!reference(value.sourceId)||!reference(value.sourceVersion))return null;
  if(value.kind==='guest'&&value.ownerId===''&&value.agentId===''&&reference(value.visitorId))return{origin:value.origin,instanceId:value.instanceId,kind:'guest',ownerId:'',agentId:'',visitorId:value.visitorId,sourceId:value.sourceId,sourceVersion:value.sourceVersion};
  if(value.kind!=='owner'||!reference(value.ownerId)||!bounded(value.agentId))return null;
  return{origin:value.origin,instanceId:value.instanceId,kind:'owner',ownerId:value.ownerId,agentId:value.agentId,sourceId:value.sourceId,sourceVersion:value.sourceVersion};
}
function scopeKey(scope){return scope?JSON.stringify([scope.origin,scope.instanceId,scope.kind,scope.ownerId,scope.agentId,scope.visitorId||'',scope.sourceId,scope.sourceVersion]):'';}
function readState(value){
  const next=emptyState();if(!plain(value))return next;
  const inventory=value.inventory;
  if(plain(inventory)){
    if(categories.includes(inventory.category))next.inventory.category=inventory.category;
    if(bounded(inventory.query,100))next.inventory.query=inventory.query;
    if(bounded(inventory.selectedId))next.inventory.selectedId=inventory.selectedId;
    next.inventory.scrollTop=position(inventory.scrollTop);
    next.inventory.detailScrollTop=position(inventory.detailScrollTop);
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
    if(plain(mail.bodyScrollTop?.[channel]))for(const [id,top]of Object.entries(mail.bodyScrollTop[channel]).slice(0,500))if(reference(id)&&Number.isFinite(top)&&top>=0)Object.defineProperty(next.mail.bodyScrollTop[channel],id,{value:position(top),enumerable:true,writable:true,configurable:true});
  }
  if(plain(mail.undo)&&Number.isFinite(mail.undo.expiresAt)&&mail.undo.expiresAt>0){
    next.mail.undo={expiresAt:mail.undo.expiresAt,entries:(Array.isArray(mail.undo.entries)?mail.undo.entries:[]).filter(entry=>channels.includes(entry?.channel)&&reference(entry.id)&&typeof entry.read==='boolean'&&next.mail.hiddenIds[entry.channel].includes(entry.id)).slice(0,500).map(entry=>({channel:entry.channel,id:entry.id,read:entry.read}))};
  }
  return next;
}
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}

// This store owns only human demo-view preferences. It never changes source
// records, account capabilities, business status or an Agent's reading cursor.
export function createLocalHudState({storage=browserStorage(),now=Date.now}={}){
  let scope=null,key='',revision=0,state=emptyState(),persistence=storage?'saved':'memory',contextPersistent=true,disposed=false;
  const listeners=new Set();
  const snapshot=()=>({scope:scope?clone(scope):null,revision,state:clone(state),persistence});
  const emit=()=>{for(const listener of listeners)listener(snapshot());};
  function current(lease){return !disposed&&Boolean(key)&&lease?.key===key&&lease.revision===revision;}
  function persist(){
    if(!scope||!storage||!contextPersistent)return;
    try{storage.setItem(prefix+encodeURIComponent(key),JSON.stringify({format,scope,state}));persistence='saved';}
    catch{persistence='memory';}
  }
  function commit(lease,change){if(!current(lease))return false;change();persist();emit();return true;}
  function setContext(value,{persistent=true}={}){
    if(disposed)return;
    const next=normalizeScope(value),nextKey=scopeKey(next);if(nextKey===key&&persistent===contextPersistent)return;
    revision++;scope=next;key=nextKey;contextPersistent=persistent;state=emptyState();persistence=storage&&persistent?'saved':'memory';
    if(scope&&storage&&persistent){try{
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
      if(!plain(patch)||Object.keys(patch).some(field=>!['category','query','selectedId','scrollTop','detailScrollTop'].includes(field)))return false;
      if('category'in patch&&!categories.includes(patch.category)||'query'in patch&&!bounded(patch.query,100)||'selectedId'in patch&&!bounded(patch.selectedId)||['scrollTop','detailScrollTop'].some(field=>field in patch&&(!Number.isFinite(patch[field])||patch[field]<0)))return false;
      return commit(lease,()=>{state.inventory={...state.inventory,...patch};state.inventory.scrollTop=position(state.inventory.scrollTop);state.inventory.detailScrollTop=position(state.inventory.detailScrollTop);});
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
    mailPosition(lease,channel,id,top){if(!channels.includes(channel)||!reference(id)||!Number.isFinite(top)||top<0)return false;return commit(lease,()=>{state.mail.bodyScrollTop[channel]={...state.mail.bodyScrollTop[channel],[id]:position(top)};});},
    hideMessage(lease,channel,id){
      if(!channels.includes(channel)||!reference(id))return false;
      return commit(lease,()=>{state.mail.hiddenIds[channel]=[...new Set([...state.mail.hiddenIds[channel],id])].slice(-500);if(state.mail.selectedIds[channel]===id)state.mail.selectedIds[channel]='';});
    },
    restoreMessage(lease,channel,id){
      if(!channels.includes(channel)||!reference(id))return false;
      return commit(lease,()=>{state.mail.hiddenIds[channel]=state.mail.hiddenIds[channel].filter(value=>value!==id);});
    },
    removeMessage(lease,channel,id){
      if(!channels.includes(channel)||!reference(id))return false;
      return commit(lease,()=>{
        const time=now(),group=state.mail.undo.expiresAt>time?state.mail.undo.entries:[];
        if(!group.some(entry=>entry.channel===channel&&entry.id===id))group.push({channel,id,read:state.mail.readIds[channel].includes(id)});
        state.mail.undo={entries:group.slice(-500),expiresAt:time+10000};
        state.mail.hiddenIds[channel]=[...new Set([...state.mail.hiddenIds[channel],id])].slice(-500);
        if(state.mail.selectedIds[channel]===id)state.mail.selectedIds[channel]='';
      });
    },
    undoRemoval(lease){
      if(!current(lease)||state.mail.undo.expiresAt<=now())return false;
      return commit(lease,()=>{
        for(const entry of state.mail.undo.entries){
          state.mail.hiddenIds[entry.channel]=state.mail.hiddenIds[entry.channel].filter(id=>id!==entry.id);
          const read=new Set(state.mail.readIds[entry.channel]);if(entry.read)read.add(entry.id);else read.delete(entry.id);state.mail.readIds[entry.channel]=[...read].slice(-500);
        }
        state.mail.undo={entries:[],expiresAt:0};
      });
    },
    expireUndo(lease){if(!current(lease)||!state.mail.undo.expiresAt||state.mail.undo.expiresAt>now())return false;return commit(lease,()=>{state.mail.undo={entries:[],expiresAt:0};});},
    reconcile(lease,catalogue){
      if(!plain(catalogue)||!['items','private','world'].every(key=>Array.isArray(catalogue[key])))return false;
      const allowed={items:new Set(ids(catalogue.items)),private:new Set(ids(catalogue.private)),world:new Set(ids(catalogue.world))};
      return commit(lease,()=>{
        if(!allowed.items.has(state.inventory.selectedId)){state.inventory.selectedId='';state.inventory.detailScrollTop=0;}
        for(const channel of channels){
          state.mail.readIds[channel]=state.mail.readIds[channel].filter(id=>allowed[channel].has(id));state.mail.hiddenIds[channel]=state.mail.hiddenIds[channel].filter(id=>allowed[channel].has(id));
          if(!allowed[channel].has(state.mail.selectedIds[channel]))state.mail.selectedIds[channel]='';
          state.mail.bodyScrollTop[channel]=Object.fromEntries(Object.entries(state.mail.bodyScrollTop[channel]).filter(([id])=>allowed[channel].has(id)));
        }
        state.mail.undo.entries=state.mail.undo.entries.filter(entry=>allowed[entry.channel].has(entry.id));if(!state.mail.undo.entries.length)state.mail.undo.expiresAt=0;
      });
    },
    dispose(){if(disposed)return;disposed=true;revision++;scope=null;key='';state=emptyState();listeners.clear();},
  };
}
