import {readdir,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from '../../apps/web/public/i18n/vendor/formatjs.js';

const locales=['zh-CN','en'],namespacePattern=/^[a-z][a-z0-9-]{0,47}$/,keyPattern=/^[A-Za-z0-9_.:\/-]{1,200}$/;
const officialNamespaces=new Set(['world-content','life-content']),digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,max=2048)=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
const keys=(value,required,optional=[])=>record(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const flat=value=>record(value)&&Object.keys(value).length<=32&&Object.entries(value).every(([key,v])=>string(key,160)&&(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||string(v)));
const sourcePath=value=>string(value,512)&&!value.startsWith('/')&&!/[\\\0]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const identical=(value,expected)=>record(value)&&Object.keys(value).length===Object.keys(expected).length&&Object.entries(expected).every(([key,item])=>value[key]===item);
const announcementStateFields=Object.freeze({moduleId:'ref.moduleId',type:'ref.type',dataMode:'content.dataMode',sourceId:'sourceId',sourceKind:'content.source.kind',sourceReference:'content.source.reference',contentComplete:'contentComplete'});
const listBundleShapes={
 pixelTownLayout:{path:'apps/web/public/world-life/world-map-expansion-v1.json',sourceRef:'town-expansion-layout-v1',version:'town-expansion-layout-v1',byteSha256:'6c7424d586209179299f57439c9df8e4eb6bc63df23e57c69422d5c53ff8955f'},
 lifeSpatialTargets:{path:'apps/web/public/world-life/spatial-manifest-c-v1.json',sourceRef:'m3-life-c-semantic-v1',version:3,byteSha256:'e30e46f7a6d66315b11af0eb7896908e84e5a70af0a0bfe72006fbbb8199152a',canonicalSha256:'2076d33e64f9d9c287c03f651a85668d0c4ba00a834fd7bffa6efb0ad7061679'},
 commons:{path:'apps/web/public/world-pixel/town.js',symbol:'COMMONS_PLACE',sourceRef:'COMMONS_PLACE',version:null},
};
const sorted=value=>Array.isArray(value)?value.map(sorted):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
async function listBundles(publicRoot,namespace,declaration,source,bad){
 if(declaration===undefined)return null;if(namespace!=='world-content'||!keys(declaration,Object.keys(listBundleShapes)))bad();const result={};
 for(const [id,expected]of Object.entries(listBundleShapes)){
  const value=declaration[id],extra=id==='commons'?['verification']:id==='lifeSpatialTargets'?['versionKind','canonicalization','verification']:['versionKind','verification'];
  if(!keys(value,[...Object.keys(expected),...extra])||Object.entries(expected).some(([key,actual])=>value[key]!==actual)||extra.some(key=>!string(value[key])))bad();
  const path=resolve(publicRoot,expected.path.slice('apps/web/public/'.length));if(await realpath(path)!==path||!(await lstat(path)).isFile())bad();const bytes=await source(path);if(bytes.length>2*1024*1024)bad();
  if(id==='commons'){result[id]={declaration:value,records:new Set(['commons'])};continue;}
  if(createHash('sha256').update(bytes).digest('hex')!==expected.byteSha256)bad();const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(id==='pixelTownLayout'){if(body.version!==expected.version||body.mapId!=='pixel-town-v2'||body.rulesetVersion!==6||body.topologyVersion!==6||!Array.isArray(body.buildings)||body.buildings.length!==31||!Array.isArray(body.districts)||body.districts.filter(d=>d.newRegion===true).length!==6)bad();result[id]={declaration:value,records:new Set([...body.buildings.map(b=>b.id),...body.districts.filter(d=>d.newRegion===true).map(d=>'region:'+d.id)])};}
  else{if(body.id!==expected.sourceRef||body.revision!==3||!Array.isArray(body.places)||body.places.length!==9||createHash('sha256').update(JSON.stringify(sorted(body))).digest('hex')!==expected.canonicalSha256)bad();result[id]={declaration:value,records:new Set(body.places.map(p=>'life-place:'+p.placeId))};}
 }
 return result;
}
function listSourceValid(group,bundles){
 const source=group.currentSource;if(!bundles||!keys(source,['bundle','recordIdField','fields','requireCompleteRecord','meaning'])||!Object.hasOwn(bundles,source.bundle)||source.recordIdField!=='id'||source.requireCompleteRecord!==true||!string(source.meaning)||!identical(source.fields,{area:'area',name:'name'})||JSON.stringify([...group.digestFields].sort())!==JSON.stringify(['area','name']))return false;
 const bundle=bundles[source.bundle];if(!bundle.records.has(group.sourceId)||group.sourceRef!==bundle.declaration.sourceRef||group.version!==bundle.declaration.version)return false;
 if(source.bundle==='commons')return identical(group.selector,{projection:'pixel-town.commons'})&&identical(group.stateGuards,{kind:'world-place'});
 if(source.bundle==='pixelTownLayout')return identical(group.selector,{projection:'pixel-town.places'})&&identical(group.stateGuards,{kind:group.sourceId.startsWith('region:')?'world-region':'world-place',mapId:'pixel-town-v2',rulesetVersion:6,topologyVersion:6,layoutSha256:bundle.declaration.byteSha256});
 return identical(group.selector,{projection:'lifePlaceTargets'})&&identical(group.stateGuards,{kind:'life-place',placeId:group.sourceId.slice('life-place:'.length),spatialCanonicalSha256:bundle.declaration.canonicalSha256});
}
function currentSourceValid(group,bundles){
 const value=group.currentSource;if(value===undefined)return true;if(Object.hasOwn(value??{},'bundle'))return listSourceValid(group,bundles);
 // Retain the original descriptive source form. These fields never select a
 // request URL or authorize a read in the browser.
 if(!Object.hasOwn(value??{},'method'))return keys(value,['operation','record'],['targetId','selector'])&&string(value.operation,160)&&string(value.record,160)&&(value.targetId===undefined||string(value.targetId,160))&&(value.selector===undefined||flat(value.selector));
 if(value.method==='GET')return keys(value,['method','path','record','idField','versionField','digestFields','requireCompleteRecord'])&&value.path===`/v1/world/announcements/${group.sourceId}?worldId=default`&&value.record==='data.item'&&value.idField==='id'&&value.versionField==='version'&&value.requireCompleteRecord===true&&JSON.stringify(value.digestFields)===JSON.stringify(['author','body','title'])&&JSON.stringify([...group.digestFields].sort())===JSON.stringify(value.digestFields);
 if(value.method!=='POST')return false;
 return keys(value,['method','path','operation','channel','record','idField','versionField','digestFields','fieldMap','stateFields','requireCompleteRecord','completion'])&&value.path==='/v1/perception/detail'&&value.operation==='perception.detail'&&value.channel==='world'&&value.record==='data'&&value.idField==='ref.id'&&value.versionField==='version'&&value.requireCompleteRecord===true&&string(value.completion)&&JSON.stringify(value.digestFields)===JSON.stringify(['body','title'])&&JSON.stringify([...group.digestFields].sort())===JSON.stringify(value.digestFields)&&identical(value.fieldMap,{body:'content.text',title:'content.title'})&&identical(value.stateFields,announcementStateFields)&&identical(group.selector,{projection:'perception.detail'})&&identical(group.stateGuards,{moduleId:'world',type:'world.announcement@1',dataMode:'real',sourceId:'demo-announcements',sourceKind:'administrative_publication',sourceReference:group.sourceRef,contentComplete:true});
}
async function contentSourceIndex(publicRoot,namespace,messageKeys,source){
 const path=resolve(publicRoot,'i18n/content-sources',namespace+'.json');
 if(await realpath(path)!==path||!(await lstat(path)).isFile())throw new Error('Official content indices must be regular contained source files');
 const bytes=await source(path);if(bytes.length>1048576)throw new Error('Official content source index exceeds 1 MiB');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bad=()=>{throw new Error('Invalid official content source index: '+namespace);};
 if(!keys(value,['schemaVersion','namespace','sourceBaseline','digestContract','resources','groups','files'],['listSourceBundles'])||value.schemaVersion!==1||value.namespace!==namespace)bad();
 if(!keys(value.sourceBaseline,['commit','appVersion','checkedDate'])||!/^[a-f0-9]{40}$/.test(value.sourceBaseline.commit)||!/^\d+\.\d+\.\d+$/.test(value.sourceBaseline.appVersion)||!/^\d{4}-\d{2}-\d{2}$/.test(value.sourceBaseline.checkedDate))bad();
 if(!keys(value.digestContract,['algorithm','encoding','canonicalization','coverage','mismatch','missingVersion'])||value.digestContract.algorithm!=='sha256'||value.digestContract.encoding!=='UTF-8'||Object.values(value.digestContract).some(v=>!string(v)))bad();
 if(!keys(value.resources,locales))bad();
 for(const locale of locales){
  const resource=value.resources[locale];if(!keys(resource,['path','sha256'])||resource.path!==`../../locales/${namespace}/${locale}.json`||!digest(resource.sha256))bad();
  if(createHash('sha256').update(await source(resolve(publicRoot,'locales',namespace,locale+'.json'))).digest('hex')!==resource.sha256)throw new Error('Official content dictionary digest differs: '+namespace+'/'+locale);
 }
 if(!Array.isArray(value.groups)||!value.groups.length||value.groups.length>512||!Array.isArray(value.files)||!value.files.length||value.files.length>128)bad();
 const bundles=await listBundles(publicRoot,namespace,value.listSourceBundles,source,bad);
 for(const group of value.groups){
  if(!keys(group,['sourceId','sourceRef','version','sourceDigest','digestFields','fields','locations','versionKind'],['access','currentSource','nativeStoryDigest','stateGuards','selector','sourceEdition','sourceEditionMeaning'])||!string(group.sourceId,160)||!string(group.sourceRef,512)||!group.currentSource?.bundle&&group.version!==null&&(!Number.isSafeInteger(group.version)||group.version<1)||!digest(group.sourceDigest)||!string(group.versionKind,512)||!record(group.fields)||!record(group.locations)||!Array.isArray(group.digestFields))bad();
  const fields=Object.keys(group.fields).sort();if(!fields.length||fields.length>32||JSON.stringify(fields)!==JSON.stringify([...group.digestFields].sort())||JSON.stringify(fields)!==JSON.stringify(Object.keys(group.locations).sort()))bad();
  for(const [field,key]of Object.entries(group.fields)){
   if(!string(field,160)||typeof key!=='string'||!messageKeys.has(namespace+':'+key))bad();const location=group.locations[field];
   if(!keys(location,['path'],['pointer','selector','context','parent','literal','transform'])||!sourcePath(location.path)||Object.hasOwn(location,'pointer')===Object.hasOwn(location,'selector')||!string(location.pointer??location.selector)||location.context!==undefined&&!flat(location.context)||location.parent!==undefined&&(!keys(location.parent,['path','selector'])||!sourcePath(location.parent.path)||!string(location.parent.selector))||location.literal!==undefined&&!(group.currentSource?.bundle==='lifeSpatialTargets'&&field==='area'&&location.path==='apps/web/public/world-pixel/life-art.js'&&location.selector==='lifePlaceTargets.area'&&location.literal==='小镇外场'||group.currentSource?.bundle==='pixelTownLayout'&&group.sourceId.startsWith('region:')&&field==='area'&&location.path==='apps/web/public/world-pixel/town.js'&&location.selector==='createPixelTown newRegion.area'&&location.literal==='公共漫步区')||location.transform!==undefined&&!(group.currentSource?.bundle==='pixelTownLayout'&&field==='area'&&location.path===listBundleShapes.pixelTownLayout.path&&location.transform==='Remove the exact leading /^[ABC] · / as createPixelTown does; otherwise preserve the full original string.'))bad();
  }
  if(group.nativeStoryDigest!==undefined&&!digest(group.nativeStoryDigest)||group.access!==undefined&&!string(group.access)||['stateGuards','selector'].some(key=>group[key]!==undefined&&!flat(group[key])))bad();
  if(Object.hasOwn(group,'sourceEdition')!==Object.hasOwn(group,'sourceEditionMeaning')||group.sourceEdition!==undefined&&(!string(group.sourceEdition,160)||!string(group.sourceEditionMeaning))||!currentSourceValid(group,bundles))bad();
 }
 if(bundles)for(const [id,bundle]of Object.entries(bundles)){const groups=value.groups.filter(g=>g.currentSource?.bundle===id),ids=new Set(groups.map(g=>g.sourceId));if(groups.length!==bundle.records.size||ids.size!==groups.length||[...bundle.records].some(id=>!ids.has(id)))bad();}
 for(const file of value.files)if(!keys(file,['path','sha256','meaning'])||!sourcePath(file.path)||!digest(file.sha256)||!string(file.meaning))bad();
}
function parameters(ast,out=new Set()){
 for(const element of ast){if([1,2,3,4,5,6,8].includes(element.type))out.add(element.value);if(element.options)for(const option of Object.values(element.options))parameters(option.value,out);if(element.children)parameters(element.children,out);}return [...out].sort();
}
function compile(bytes){
 if(bytes.length>262144)throw new Error('i18n dictionary exceeds 256 KiB');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length||Object.keys(value).length>4000)throw new Error('Expected a nonempty flat i18n dictionary');
 const messages={},contracts={};
 for(const [key,message]of Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en'))){
  if(!keyPattern.test(key)||['__proto__','constructor','prototype'].includes(key)||typeof message!=='string'||!message.length||message.length>16384||message.includes('\0'))throw new Error('Invalid explicit i18n message');
  messages[key]=parse(message,{ignoreTag:true,captureLocation:false});contracts[key]=parameters(messages[key]);
 }
 return {messages,contracts};
}
/** All content stays in independent selected-language resources, never JS imports. */
export async function buildLocaleResources({publicRoot,source,emit}){
 let entries;try{entries=await readdir(resolve(publicRoot,'locales'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(entries.length>32)throw new Error('Too many i18n namespaces');
 const namespaces={},keys=new Set();
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(!entry.isDirectory()||!namespacePattern.test(entry.name))throw new Error('Invalid i18n namespace directory');
  const directory=resolve(publicRoot,'locales',entry.name),files=await readdir(directory);
  if(files.sort().join(',')!=='en.json,zh-CN.json')throw new Error('Each i18n namespace requires exactly zh-CN and en JSON');
  let expected;namespaces[entry.name]={};
  for(const locale of locales){
   const path=resolve(directory,locale+'.json');if(!(await lstat(path)).isFile())throw new Error('i18n dictionaries must be regular files');
   const compiled=compile(await source(path)),contract=JSON.stringify(compiled.contracts);
   if(expected!==undefined&&expected!==contract)throw new Error('i18n keys or named parameters differ between languages: '+entry.name);
   expected=contract;const body=Buffer.from(JSON.stringify({version:1,locale,namespace:entry.name,messages:compiled.messages}));
   for(const key of Object.keys(compiled.messages))keys.add(entry.name+':'+key);
   if(body.length>262144)throw new Error('Compiled i18n dictionary exceeds 256 KiB');
   namespaces[entry.name][locale]=await emit(`i18n-${entry.name}-${locale}`,'json',body,'application/json; charset=utf-8');
  }
  if(officialNamespaces.has(entry.name))await contentSourceIndex(publicRoot,entry.name,keys,source);
 }
 return {manifest:{version:1,format:'icu-ast-v1',namespaces},keys};
}
