const cancelled=()=>new DOMException('Pixel asset loading cancelled','AbortError');
function imageRef(key,value,baseURL){
  if(!/^[A-Za-z0-9_-]+$/.test(key)||typeof value?.url!=='string'||!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/.test(value.url)||!Number.isSafeInteger(value.width)||value.width<1||!Number.isSafeInteger(value.height)||value.height<1||typeof value.sourcePath!=='string'||!value.sourcePath||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('pixel_image_descriptor_invalid');
  return{key,url:new URL(value.url,baseURL).href,width:value.width,height:value.height,sha256:value.sha256,sourcePath:value.sourcePath};
}
async function decodeImage(ref,signal){
  const response=await fetch(ref.url,{credentials:'omit',cache:'no-cache',signal});if(!response.ok)throw new Error('pixel_image_unavailable');
  const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(hash!==ref.sha256)throw new Error('pixel_image_hash_mismatch');if(signal.aborted)throw cancelled();
  return createImageBitmap(new Blob([bytes],{type:'image/png'}));
}
// The final dictionary is supplied explicitly. No strip filename, candidate
// anchor, decoration placement or server coordinate is inferred by this loader.
export async function loadPixelAssets(kit,{baseURL,origin=globalThis.location?.origin,signal,loadImage=decodeImage}={}){
  if(typeof kit?.version!=='string'||kit.sourcePixelSize!==16||!kit.images||!baseURL)throw new Error('pixel_kit_invalid');
  const base=new URL(baseURL);if(base.origin!==origin||!base.pathname.endsWith('/'))throw new Error('pixel_asset_origin_invalid');
  if(signal?.aborted)throw cancelled();
  const refs=Object.entries(kit.images).map(([key,value])=>imageRef(key,value,base));
  if(!refs.length)throw new Error('pixel_kit_invalid');
  const controller=new AbortController(),active=AbortSignal.any([...(signal?[signal]:[]),controller.signal,AbortSignal.timeout(15000)]);
  const settled=await Promise.allSettled(refs.map(async ref=>{try{const image=await loadImage(ref,active);if(active.aborted||image.width!==ref.width||image.height!==ref.height){image.close?.();if(active.aborted)throw cancelled();throw new Error('pixel_image_size_mismatch');}return image;}catch(error){controller.abort();throw error;}}));
  const failed=settled.find(result=>result.status==='rejected');
  if(active.aborted||failed){controller.abort();for(const result of settled)if(result.status==='fulfilled')result.value.close?.();if(active.aborted&&signal?.aborted)throw cancelled();throw failed?.reason||cancelled();}
  const images=new Map(settled.map((result,index)=>[refs[index].key,result.value]));let disposed=false;
  return{kit:structuredClone(kit),images,sourceIndex:refs.map(ref=>({...ref})),dispose(){if(disposed)return;disposed=true;controller.abort();for(const image of images.values())image.close?.();images.clear();}};
}
