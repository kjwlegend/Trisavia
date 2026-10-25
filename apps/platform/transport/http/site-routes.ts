import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {containedWebPath,loadProductionWebAssets,WEB_MIME,webSha256,type ProductionWebAssets,type VerifiedWebFile} from './web-assets.ts';

const defaultWebRoot=fileURLToPath(new URL('../../../web/public/',import.meta.url));
const defaultRepoRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const compress=promisify(gzip);
export interface SiteRouteOptions {assetMode?:'source'|'production';repoRoot?:string;webRoot?:string;buildRoot?:string}
function missing(reply:FastifyReply){return reply.type('application/json; charset=utf-8').code(404).send({error:{code:'not_found',message:'Resource not found'}});}
function unavailable(reply:FastifyReply){return reply.type('application/json; charset=utf-8').code(503).send({error:{code:'web_asset_unavailable',message:'The production web asset is unavailable'}});}
const anonymous=(request:FastifyRequest)=>request.headers.authorization===undefined&&request.headers.cookie===undefined;
function matches(header:unknown,etag:string):boolean{
 return typeof header==='string'&&header.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag.replace(/^W\//,''));
}
function varyEncoding(reply:FastifyReply){
 const current=String(reply.getHeader('Vary')??''),values=current.split(',').map(v=>v.trim()).filter(Boolean);
 if(!values.some(v=>v.toLowerCase()==='accept-encoding')&&!values.includes('*'))values.push('Accept-Encoding');
 reply.header('Vary',values.join(', '));
}
function acceptsGzip(value:unknown):boolean{
 if(typeof value!=='string')return false;
 const encodings=new Map<string,number>();
 for(const part of value.split(',')){const [name,...params]=part.trim().toLowerCase().split(';'),q=params.find(p=>p.trim().startsWith('q='));if(name)encodings.set(name,q===undefined?1:Number(q.trim().slice(2)));}
 const quality=encodings.get('gzip')??encodings.get('*')??0;return Number.isFinite(quality)&&quality>0&&quality<=1;
}
export function registerSiteRoutes(app:FastifyInstance,options:SiteRouteOptions={}):void{
 const repoRoot=options.repoRoot??defaultRepoRoot,webRoot=options.webRoot??defaultWebRoot,buildRoot=options.buildRoot??resolve(repoRoot,'dist/web');
 const mode=options.assetMode??process.env.WEB_ASSET_MODE??'source';
 if(mode!=='source'&&mode!=='production')throw new Error('WEB_ASSET_MODE must be source or production');
 const production:ProductionWebAssets|undefined=mode==='production'?loadProductionWebAssets(repoRoot,buildRoot):undefined;
 const policies=new WeakMap<FastifyReply,string>();
 app.addHook('onSend',async(request,reply,payload)=>{
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('Referrer-Policy','no-referrer');
  // Only file() marks identity-independent public files. Header presence cannot personalize these bytes.
  const publicFile=policies.has(reply)&&(reply.statusCode===200||reply.statusCode===304);
  reply.header('Cache-Control',publicFile?policies.get(reply)!:'no-store');
  reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  // Public files keep the same transport policy with incidental credentials; other authenticated responses remain untouched.
  const type=String(reply.getHeader('Content-Type')??'');
  if(reply.statusCode===200&&(publicFile||anonymous(request))&&['GET','HEAD'].includes(request.method)&&/^(application\/json|image\/svg\+xml|text\/(?:html|javascript|css))\b/.test(type)&&!reply.hasHeader('Content-Encoding')&&(typeof payload==='string'||Buffer.isBuffer(payload))){
   varyEncoding(reply);
   const bytes=typeof payload==='string'?Buffer.from(payload):payload;
   if(bytes.length>=1024&&acceptsGzip(request.headers['accept-encoding'])){
    const compressed=await compress(bytes);
    if(compressed.length<bytes.length){reply.header('Content-Encoding','gzip');reply.header('Content-Length',compressed.length);return compressed;}
   }
  }
  return payload;
 });
 async function file(request:FastifyRequest,reply:FastifyReply,root:string,name:string,cache?:'revalidate'|'immutable',expected?:VerifiedWebFile){
  let body:Buffer;
  try{body=await readFile(await containedWebPath(root,name));}
  catch{return expected?unavailable(reply):missing(reply);}
  if(expected&&(body.length!==expected.bytes||webSha256(body)!==expected.sha256))return unavailable(reply);
  if(expected)reply.type(expected.contentType);
  else if(!reply.hasHeader('Content-Type'))reply.type(WEB_MIME[extname(name)]??'text/plain; charset=utf-8');
  if(cache){
   const etag='W/"sha256-'+(expected?.sha256??webSha256(body))+'"';
   policies.set(reply,cache==='immutable'?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
   reply.header('ETag',etag);varyEncoding(reply);
   if(matches(request.headers['if-none-match'],etag))return reply.code(304).send();
  }
  return reply.send(body);
 }
 for(const [route,page,name]of [['/','index','index.html'],['/owner','index','index.html'],['/residents/:agentId','resident','resident.html'],['/releases','releases','releases.html'],['/kanban','kanban','kanban.html']] as const){
  app.get(route,(request,reply)=>mode==='production'?production?file(request,reply,buildRoot,name,undefined,production.pages[page]):unavailable(reply):file(request,reply,webRoot,name));
 }
 app.get('/world-map-life-v1.json',(request,reply)=>file(request,reply,webRoot,'world-map-life-v1.json','revalidate'));
 app.get('/world-map-v2.json',(request,reply)=>file(request,reply,webRoot,'world-map-v2.json','revalidate'));
 app.get('/favicon.ico',(_request,reply)=>reply.code(204).send());
 app.get('/assets/*',async(request,reply)=>{
  const name=(request.params as {'*':string})['*'],type=WEB_MIME[extname(name)];
  if(!type||extname(name)==='.html')return missing(reply);
  if(name.startsWith('build/')){
   const asset=production?.assets.get('/assets/'+name);
   return asset?file(request,reply,buildRoot,asset.file,'immutable',asset):missing(reply);
  }
  return file(request,reply,webRoot,name,'revalidate');
 });
 for(const name of ['entry.md','http-api.md','local-setup.md','prompt.md','avatar.md']){
  app.get('/agent/'+name,(request,reply)=>{reply.type('text/markdown; charset=utf-8');return file(request,reply,repoRoot,'docs/access/v1/'+name);});
 }
 app.get('/agent/m1-agent.ts',(request,reply)=>file(request,reply,repoRoot,'scripts/m1-agent.ts'));
}
