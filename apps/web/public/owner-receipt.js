const authenticationActions=new Set(['login','registerOwner','completeSetup','recover']);

// Keep receipt authentication tied to the context that actually issued the GET.
// A failed receipt does not say whether the original command committed.
export function createOwnerReceiptReader({request,context,expire}){
  return async pending=>{
    const snapshot=context();
    const token=pending.action==='rejectRecoveryRequest'?(snapshot.recoveryToken||snapshot.sessionToken):snapshot.sessionToken;
    const managementSession=snapshot.authenticated===true&&Boolean(snapshot.sessionToken)&&token===snapshot.sessionToken&&pending.scope===`owner:${snapshot.ownerId}`&&!authenticationActions.has(pending.action);
    try{return await request(`/operations/${encodeURIComponent(pending.operationId)}?scope=${encodeURIComponent(pending.scope)}&action=${encodeURIComponent(pending.action)}`,{token});}
    catch(error){
      if(error.status===401&&managementSession){
        const current=context();
        if(current.source===snapshot.source&&current.ownerId===snapshot.ownerId&&current.sessionToken===snapshot.sessionToken&&current.generation===snapshot.generation)expire({source:snapshot.source,sessionToken:snapshot.sessionToken,generation:snapshot.generation});
      }
      throw error;
    }
  };
}

// Used by both automatic unknown-result branches. Receipt failures leave the
// original pending command and its pre-saved materials with their current owner.
export async function confirmUnknownOwnerOperation(pending,{receipt,committed}){
  try{await committed(await receipt(pending),pending);return true;}
  catch{return false;}
}
