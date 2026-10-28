// The existing health response reads package.json through APP_VERSION.
// A failed read leaves the optional label absent; this read never polls.
import {bindAttribute} from '../i18n/core.js';
export async function showHeaderVersion(node){
 node.hidden=true;
 try{
  const response=await fetch('/health',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return;
  const value=await response.json();
  if(value.status!=='ok'||typeof value.appVersion!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.appVersion))return;
  node.textContent=`v${value.appVersion}`;bindAttribute(node,'aria-label','shell:version.label',{version:node.textContent});node.hidden=false;
 }catch{/* Version is optional and never guessed from another source. */}
}
