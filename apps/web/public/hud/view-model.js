function sourceReady(snapshot,provider){
  return Boolean(snapshot?.scope&&provider?.phase==='ready'&&provider.data?.sourceId===snapshot.scope.sourceId&&provider.data.sourceVersion===snapshot.scope.sourceVersion);
}
function validEntries(value){
  const seen=new Set();return(Array.isArray(value)?value:[]).filter(entry=>{
    if(!entry||typeof entry.id!=='string'||!entry.id||seen.has(entry.id))return false;
    seen.add(entry.id);return true;
  });
}

// Selection is derived from the visible current source, never from a stored ID
// alone. Callers keep details closed when that source is not ready.
export function projectInventoryView(snapshot,provider){
  if(!sourceReady(snapshot,provider))return{ready:false,items:[],selectedId:'',selected:null};
  const view=snapshot.state.inventory,categories={all:'',artwork:'作品',item:'虚拟道具'};
  const items=validEntries(provider.data.items).filter(item=>(!categories[view.category]||item.category===categories[view.category])&&typeof item.name==='string'&&item.name.includes(view.query)).map(item=>structuredClone(item));
  const selected=items.find(item=>item.id===view.selectedId)||items[0]||null;
  return{ready:true,items,selectedId:selected?.id||'',selected};
}

export function projectMailView(snapshot,provider){
  const channel=snapshot?.state?.mail?.channel==='world'?'world':'private';
  if(!sourceReady(snapshot,provider))return{ready:false,channel,messages:[],selectedId:'',selected:null};
  const view=snapshot.state.mail,filter=view.filters[channel],read=new Set(view.readIds[channel]),hidden=new Set(view.hiddenIds[channel]);
  const messages=validEntries(channel==='private'?provider.data.messages:provider.data.announcements)
    .filter(message=>!hidden.has(message.id)&&(!filter.pending||channel==='world'||message.status==='待处理'&&message.available===true))
    .filter(message=>filter.read==='all'||(filter.read==='read')===read.has(message.id))
    .map(message=>{
      if(message.available===true)return{...structuredClone(message),humanRead:read.has(message.id)};
      const{id,title,source,status,time}=message;return{id,title,source,status,time,available:false,humanRead:read.has(id)};
    });
  const selected=messages.find(message=>message.id===view.selectedIds[channel])||messages[0]||null;
  return{ready:true,channel,messages,selectedId:selected?.id||'',selected};
}

export function projectMessageDetail(snapshot,provider,channel,id){
  if(!sourceReady(snapshot,provider)||!['private','world'].includes(channel)||snapshot.state.mail.hiddenIds[channel].includes(id))return null;
  const message=validEntries(channel==='private'?provider.data.messages:provider.data.announcements).find(entry=>entry.id===id);if(!message)return null;
  const humanRead=snapshot.state.mail.readIds[channel].includes(id);
  if(message.available===true)return{...structuredClone(message),humanRead};
  const{title,source,status,time}=message;return{id,title,source,status,time,available:false,humanRead};
}
