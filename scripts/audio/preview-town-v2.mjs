import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),port=Number(process.argv[2]??18961);
if(!Number.isInteger(port)||port<1024||port>65535||[18893,18940].includes(port))throw new Error('Choose a separate loopback audition port');
const types={'.html':'text/html; charset=utf-8','.json':'application/json','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url??'/',`http://127.0.0.1:${port}`).pathname;
 const relative=path==='/'?'outputs/audio-town-v2/index.html':['/v1','/v1/'].includes(path)?'outputs/audio-town-v1/index.html':path.startsWith('/preview/')?'outputs/audio-town-v1/'+path.slice(9):path.startsWith('/v2-preview/')?'outputs/audio-town-v2/'+path.slice(12):/^\/assets\/audio\/town-v[12]\//.test(path)?'apps/web/public/'+path.slice(8):null;
 if(!relative||relative.includes('..')||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
 try{const bytes=await readFile(resolve(root,relative));res.writeHead(200,{'content-type':types[extname(relative)]??'application/octet-stream','cache-control':'no-store','content-length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end();}
});server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/`,pid:process.pid,cwd:root})));
