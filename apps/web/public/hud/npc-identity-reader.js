const invalid=()=>{throw Object.assign(new Error('npc_identity_invalid'),{code:'npc_identity_invalid'});};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value)&&![...value].some(char=>char.length===1&&char.charCodeAt(0)>=0xd800&&char.charCodeAt(0)<=0xdfff);
/** Official public story only; it never grants an action or supplies a private Agent biography. */
export function readNpcIdentity(value,{name,role}={}){
 const keys=['version','ref','name','role','story','digest'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.version!==1||!text(value.ref,160)||!text(value.name,120)||!text(value.role,120)||!text(value.story,1200)||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||name!==undefined&&value.name!==name||role!==undefined&&value.role!==role)invalid();
 return structuredClone(value);
}
