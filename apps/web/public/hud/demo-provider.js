// Read-only local examples: no account, ownership or unread-state mutations.
export function createDemoProvider(){let state={phase:'idle',data:null},pending=null;const listeners=new Set();const emit=value=>{state=value;for(const listener of listeners)listener(state);};
  function load(){if(state.phase==='ready')return Promise.resolve(state.data);if(pending)return pending;
    emit({phase:'loading',data:null});pending=(async()=>{try{const response=await fetch(new URL('./demo-fixtures.json',import.meta.url),{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('demo_unavailable');const data=await response.json();if(!Array.isArray(data.items)||!Array.isArray(data.messages)||!Array.isArray(data.announcements))throw new Error('invalid_demo');emit({phase:'ready',data});return data;}catch{emit({phase:'error',data:null});return null;}finally{pending=null;}})();return pending;}
  return{load,subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);}};
}
