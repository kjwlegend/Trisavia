// Design-only composition; it never derives activity, position, or rewards.
export const POSES={work:{frames:[0,1,2,4,5,7],frameMs:180},rest:{frames:[0,4],frameMs:1600},duty:{frames:[0],frameMs:0}};
export async function loadPoseAssets(){
 const images=new Map();const load=async(key,url)=>{const image=new Image();image.src=url;await image.decode();images.set(key,image);};
 await Promise.all(['base','shorthair','curlyhair','longhair','bowlhair','mophair','spikeyhair'].flatMap(hair=>[load(`${hair}-doing`,`assets/human-${hair}-doing.png`),load(`${hair}-idle`,`/frozen/world-pixel/assets/human-${hair}-idle.png`)]));
 await Promise.all(['crate','tray','bench-back','bench-front','seated-legs'].map(name=>load(name,`assets/${name}.svg`)));return images;
}
// x/y is the native feet anchor. Mirror the complete actor, never hair alone.
export function drawPose(ctx,images,{x,y,hair='bowlhair',state='duty',prop='crate',phase=0,facing='right',bench=true}){
 ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.imageSmoothingEnabled=false;
 if(state==='rest'&&bench){ctx.drawImage(images.get('bench-back'),-14,-13);ctx.drawImage(images.get('bench-front'),-14,-2);}
 ctx.save();if(facing==='left')ctx.scale(-1,1);
 const spec=POSES[state]||POSES.duty,frame=spec.frames[Math.max(0,Math.floor(phase))%spec.frames.length],animation=state==='work'?'doing':'idle';
 if(state==='rest'){
  // Source PNG remains byte-identical: render upper body plus new bent-leg layer.
  for(const part of ['base',hair])ctx.drawImage(images.get(`${part}-${animation}`),frame*96,0,96,36,-48,-38,96,36);
  ctx.drawImage(images.get('seated-legs'),-4,-3);
 }else{
  for(const part of ['base',hair])ctx.drawImage(images.get(`${part}-${animation}`),frame*96,0,96,64,-48,-39,96,64);
  if(state==='work'){const offset=[0,0,1,1,0,-1][Math.floor(phase)%6]||0;ctx.drawImage(images.get(prop),5,-11+offset);}
 }
 ctx.restore();ctx.restore();
}
