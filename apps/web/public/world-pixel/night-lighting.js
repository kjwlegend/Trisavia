import manifest from '../world-life/night-lights.json' with {type:'json'};

// Decorative source-pixel lighting only; no world cells, routes or capacities.
export function createNightLighting({makeCanvas=()=>document.createElement('canvas')}={}){
 const [width,height]=manifest.sourceSize,[cw,ch]=manifest.cache.resolution,lights=manifest.lights;let caches=null,disposed=false;
 function build(){
  const layers=manifest.cache.layers.map(()=>{const c=makeCanvas();c.width=cw;c.height=ch;return c;}),veil=layers[0].getContext('2d'),warm=layers[1].getContext('2d'),sx=cw/width,sy=ch/height;
  veil.fillStyle=`rgba(${manifest.palette.night.color.join(',')},${manifest.palette.night.opacity})`;veil.fillRect(0,0,cw,ch);
  for(const light of lights){
   const [x,y]=light.groundAnchor.map((v,i)=>v*(i?sy:sx)),r=light.radius*sx,cut=veil.createRadialGradient(x,y,0,x,y,r);
   for(const [at,value]of manifest.lightModel.falloffStops)cut.addColorStop(at,`rgba(0,0,0,${value*light.clearance})`);
   veil.globalCompositeOperation='destination-out';veil.fillStyle=cut;veil.fillRect(x-r,y-r,r*2,r*2);
   const glow=warm.createRadialGradient(x,y,0,x,y,r*.8);glow.addColorStop(0,`rgba(255,209,138,${light.warmAlpha})`);glow.addColorStop(1,'rgba(255,209,138,0)');warm.fillStyle=glow;warm.fillRect(x-r,y-r,r*2,r*2);
  }
  // One build-time clamp; drawing/zooming never reads pixels or allocates masks.
  const pixels=veil.getImageData(0,0,cw,ch),floor=Math.round(manifest.lightModel.darknessFloor*255);for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=Math.max(floor,pixels.data[i]);veil.putImageData(pixels,0,0);return layers;
 }
 function fixture(ctx,light){const [x,y]=light.groundAnchor;if(light.kind==='verge'){ctx.fillStyle='#5f6150';ctx.fillRect(x-2,y-23,4,23);ctx.fillStyle='#b5a875';ctx.fillRect(x-1,y-22,1,21);ctx.fillStyle='#63523e';ctx.fillRect(x-6,y-25,12,3);ctx.fillRect(x-5,y-23,10,8);ctx.fillStyle='#e5c683';ctx.fillRect(x-3,y-22,6,5);ctx.fillStyle='#615a43';ctx.fillRect(x-4,y-1,8,2);}else{ctx.fillStyle='#63523e';ctx.fillRect(x-4,y-4,8,9);ctx.fillStyle='#e5c683';ctx.fillRect(x-2,y-2,4,5);}}
 return{
  objects:lights.filter(l=>l.kind==='verge').map(light=>({kind:'prop',id:'night-light:'+light.id,x:light.groundAnchor[0],y:light.groundAnchor[1],draw:ctx=>fixture(ctx,light)})),
  drawUpper(ctx){if(!disposed)for(const light of lights)if(light.kind==='wall')fixture(ctx,light);},
  draw(ctx,amount,viewport){
   if(disposed||!(amount>0))return;caches??=build();ctx.save();ctx.globalAlpha=amount;
   // Match the old veil outside the source image in a fully zoomed-out view.
   const v=viewport;ctx.fillStyle=`rgba(${manifest.palette.night.color.join(',')},${manifest.palette.night.opacity})`;if(v){const x=Math.max(0,v.left),w=Math.max(0,Math.min(width,v.right)-x);if(v.left<0)ctx.fillRect(v.left,v.top,-v.left,v.bottom-v.top);if(v.right>width)ctx.fillRect(width,v.top,v.right-width,v.bottom-v.top);if(v.top<0)ctx.fillRect(x,v.top,w,-v.top);if(v.bottom>height)ctx.fillRect(x,height,w,v.bottom-height);}
   ctx.imageSmoothingEnabled=true;ctx.drawImage(caches[0],0,0,width,height);ctx.globalCompositeOperation='screen';ctx.drawImage(caches[1],0,0,width,height);ctx.restore();
   ctx.save();ctx.globalAlpha=amount;ctx.fillStyle=manifest.lightModel.coreColor;for(const light of lights){const [x,y]=light.groundAnchor,[dx,dy]=light.emitterOffset;ctx.fillRect(x+dx-2,y+dy-1,...manifest.lightModel.coreSize);}ctx.restore();
  },
  dispose(){if(disposed)return;disposed=true;for(const cache of caches||[]){cache.width=0;cache.height=0;}caches=null;},
 };
}
