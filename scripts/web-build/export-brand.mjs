import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),directory=resolve(root,'apps/web/public/brand/trisavia-02'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exports=[];
for(const [name,size] of [['trisavia-nav-lockup',128],['trisavia-small-mark-framed',128]]){
 const source=await readFile(resolve(directory,name+'.svg'),'utf8'),match=source.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);if(!match)throw new Error('Approved embedded PNG is missing');
 const original=Buffer.from(match[1],'base64'),png=execFileSync('magick',['png:-','-colorspace','sRGB','-resize',`${size}x${size}!`,'-strip','-define','png:color-type=6','-define','png:compression-level=9','png:-'],{input:original,maxBuffer:4*1024*1024});
 const output=source.replace(match[0],'data:image/png;base64,'+png.toString('base64')),file=name+'.performance.svg';await writeFile(resolve(directory,file),output);
 exports.push({source:name+'.svg',sourceSha256:sha(Buffer.from(source)),file,sha256:sha(Buffer.from(output)),bytes:Buffer.byteLength(output),embeddedRaster:{width:size,height:size},preserves:'Original SVG viewBox, framing, dimensions, text, colors and element geometry; only embedded raster downsampling and metadata removal.'});
}
const manifest={version:1,method:'ImageMagick Lanczos downsample to sRGB PNG, strip metadata; original SVG geometry/text unchanged',exports};await writeFile(resolve(directory,'performance-exports.json'),JSON.stringify(manifest,null,2)+'\n');console.info(JSON.stringify({brandBytes:exports.reduce((n,e)=>n+e.bytes,0),exports}));
