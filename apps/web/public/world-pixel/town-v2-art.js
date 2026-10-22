// Drawing extracted from the approved v2 designer export. No route planner,
// local roamer, manual daylight control or NPC facts are imported from the preview.
export function createTownV2Art(assets,L,{makeCanvas=()=>document.createElement('canvas')}={}){
  const A=assets.kit,images=assets.images,buildingArt=new Map(),WIDTH=L.source.width,HEIGHT=L.source.height;
  const ground=makeCanvas();ground.width=WIDTH;ground.height=HEIGHT;const gc=ground.getContext('2d');gc.imageSmoothingEnabled=false;
  const point=(x,y)=>[L.origin.source[0]+x*16,L.origin.source[1]+y*16],sourceForCell=(x,y)=>point(x,y).map(v=>v-8),hash=(x,y)=>(((x*73856093)^(y*19349663)^0x9e3779b9)>>>0),solids=new Set(L.physicalBlocked.map(r=>r.cell.join(',')));
  function sprite(c,key,x,y,flags={}){const s=typeof key==='string'?A.sprites[key]:key;if(!s)return;const im=images.get(s.image);if(!im)return;const [sx,sy,w,h]=s.rect;if(flags.flipX||flags.flipY||flags.rotate90){c.save();c.translate(Math.round(x+w/2),Math.round(y+h/2));if(flags.rotate90)c.rotate(Math.PI/2);c.scale(flags.flipX?-1:1,flags.flipY?-1:1);c.drawImage(im,sx,sy,w,h,-w/2,-h/2,w,h);c.restore();}else c.drawImage(im,sx,sy,w,h,Math.round(x),Math.round(y),w,h);}
  function shadow(c,x,y,w=17,h=5,alpha=.16){c.fillStyle=`rgba(35,60,32,${alpha})`;c.fillRect(Math.round(x-w/2)+2,Math.round(y-h/2),w-4,h);c.fillRect(Math.round(x-w/2),Math.round(y-h/2)+1,w,h-2);}
  function partsFor(style,palette,width,height){
    if(style==='linked')return [...partsFor('cottage',palette,64,64).map(p=>({...p,offset:[p.offset[0]+48,p.offset[1]+32]})),...partsFor('gable',palette,64,96)];
    const gable=style==='gable'||style==='tower';
    const original=A.modules[`${gable?'gabledHouse':'house'}${palette}`];
    let columns=width===48?[0,gable?32:16,64]:width===64?(gable?[0,16,32,64]:[0,16,48,64]):width>80?Array.from({length:width/16},(_,i)=>i===0?0:i===width/16-1?64:i===1?16:32+((i-2)%2)*16):[0,16,32,48,64];
    const parts=[];
    for(let i=0;i<columns.length;i++)for(const p of original.parts){
      if(p.offset[0]!==columns[i])continue;
      let y=p.offset[1];
      if(height===64){if(y===32)continue;if(y>=48)y-=16;}
      if(style==='tower'&&y>=80)y+=16;
      parts.push({...p,offset:[i*16,y]});
    }
    if(style==='tower'){
      const wall=A.modules[`house${palette}`];
      for(let i=0;i<columns.length;i++)for(const p of wall.parts)if(p.offset[0]===columns[i]&&p.offset[1]===48)parts.push({...p,offset:[i*16,80]});
    }
    return parts;
  }
  function makeBuildingArt(b){const c=makeCanvas();c.width=b.size[0];c.height=b.size[1]+6;const x=c.getContext('2d');x.imageSmoothingEnabled=false;if(customBuilding(x,b)){refineCustomBuilding(x,b);buildingArt.set(b.id,c);return;}const parts=partsFor(b.style,b.palette,...b.size);for(const p of parts)sprite(x,p.sprite,...p.offset,p);
    const [w,h]=b.size;
    if(b.features.includes('awning')){const y=h-22;x.fillStyle='#685140';x.fillRect(8,y+2,w-16,3);for(let px=8;px<w-8;px+=5){x.fillStyle=(px%10===8)?'#d0c69c':'#9d6f55';x.fillRect(px,y,5,5);}x.fillStyle='#705440';x.fillRect(9,y+5,2,15);x.fillRect(w-11,y+5,2,15);}
    if(b.features.includes('porch')){x.fillStyle='#6d5545';x.fillRect(8,h-1,w-16,5);x.fillStyle='#b89369';for(let px=10;px<w-8;px+=10)x.fillRect(px,h,8,2);}
    if(b.features.includes('stone-steps')){x.fillStyle='#7f8274';x.fillRect(b.doorOffset[0]-12,h-1,24,4);x.fillStyle='#c0bda7';x.fillRect(b.doorOffset[0]-10,h-1,20,1);x.fillRect(b.doorOffset[0]-14,h+3,28,1);}
    if(b.features.includes('shop-sign')){x.fillStyle='#66513b';x.fillRect(w-14,h-28,2,16);x.fillStyle='#c7a471';x.fillRect(w-22,h-27,14,7);x.fillStyle='#80764d';x.fillRect(w-20,h-25,10,2);}
    if(b.features.includes('clock')){x.fillStyle='#6a5c49';x.fillRect(35,h-31,10,10);x.fillStyle='#d9d0a5';x.fillRect(36,h-30,8,8);x.fillStyle='#756e54';x.fillRect(39,h-29,1,4);x.fillRect(39,h-26,3,1);}
    buildingArt.set(b.id,c);
  }
  function paintParts(c,parts,ox=0,oy=0,omitDoor=false){for(const p of parts){if(omitDoor&&p.sprite.includes('1764'))continue;let sp=p.sprite;if(omitDoor&&sp==='tile_780_facade')sp='tile_865_facade';sprite(c,sp,p.offset[0]+ox,p.offset[1]+oy,p);}}
  function customBuilding(c,b){const [w,h]=b.size,wood='#87694d',light='#c3a77a',stone='#949b86';
    if(b.style==='hall'){paintParts(c,partsFor('cottage',b.palette,80,64),0,48,true);paintParts(c,partsFor('cottage',b.palette,80,64),112,48,true);paintParts(c,partsFor('tower',b.palette,80,112),56,0);c.fillStyle=stone;c.fillRect(8,110,176,5);c.fillStyle='#d0c6a5';c.fillRect(20,110,152,1);c.fillStyle='#666f61';c.fillRect(89,81,14,9);c.fillStyle='#d6c995';c.fillRect(92,83,8,5);return true;}
    if(b.style==='warehouse'||b.style==='porchShop'||b.style==='boatShed'){paintParts(c,partsFor('long',b.palette,w,b.style==='warehouse'?80:64));if(b.style==='warehouse'){for(let x=16;x<w-8;x+=40){c.fillStyle='#765e44';c.fillRect(x,9,24,10);c.fillStyle='#d0ac73';c.fillRect(x+3,6,18,3);c.fillStyle='#a9a58b';c.fillRect(x+6,9,12,5);c.fillStyle='#645a48';c.fillRect(x+10,10,1,4);}c.fillStyle='#8a6a49';c.fillRect(w-40,h-23,25,20);c.fillStyle='#b7986a';for(let x=w-38;x<w-15;x+=6)c.fillRect(x,h-22,1,17);}if(b.style==='porchShop'){c.fillStyle=wood;c.fillRect(4,h-2,w-8,7);c.fillStyle=light;for(let x=8;x<w-4;x+=8)c.fillRect(x,h,6,1);c.fillStyle='#e6c89c';for(let x=8;x<w-8;x+=12)c.fillRect(x,h-23,6,4);c.fillStyle='#7a5844';c.fillRect(w-18,h-26,3,20);c.fillStyle='#d5c094';c.fillRect(w-27,h-27,17,12);c.fillStyle='#695740';c.fillRect(w-22,h-24,5,5);c.fillRect(w-17,h-23,2,3);}if(b.style==='boatShed'){c.fillStyle='#48584f';c.fillRect(40,h-25,46,24);c.fillStyle=wood;c.fillRect(38,h-27,50,4);c.fillRect(38,h-24,4,24);c.fillRect(84,h-24,4,24);c.fillStyle='#b9996f';c.fillRect(45,h-3,36,2);}return true;}
    if(b.style==='beacon'){paintParts(c,partsFor('tower',b.palette,48,112));c.fillStyle=wood;c.fillRect(0,61,48,3);c.fillRect(3,55,2,8);c.fillRect(43,55,2,8);c.fillStyle=light;c.fillRect(2,55,44,1);c.fillStyle='#dfc484';c.fillRect(21,36,7,9);c.fillStyle='#f5dda6';c.fillRect(23,37,2,6);return true;}
    if(b.style==='arcade'){paintParts(c,partsFor('long',b.palette,w,64).filter(p=>p.layer==='roof'&&p.sprite!=='tile_349'));c.fillStyle='#a7aa92';c.fillRect(5,60,w-10,4);for(let x=8;x<w-4;x+=24){c.fillStyle='#7c8675';c.fillRect(x,31,6,30);c.fillStyle='#b8bba1';c.fillRect(x+1,33,3,26);c.fillRect(x-2,31,10,3);}c.fillStyle='#949d87';c.fillRect(8,30,w-16,4);return true;}
    if(b.style==='dome'){c.fillStyle='#657d70';c.fillRect(8,48,64,45);c.fillStyle='#b5baa1';c.fillRect(11,50,58,41);c.fillStyle='#819a8b';for(const [x,y,ww,hh]of [[28,9,24,9],[18,18,44,8],[11,26,58,12],[7,38,66,13]])c.fillRect(x,y,ww,hh);c.fillStyle='#aec2a6';c.fillRect(29,10,3,38);c.fillRect(48,15,2,34);c.fillStyle='#607b70';c.fillRect(8,48,64,4);c.fillStyle='#786b51';c.fillRect(33,74,14,20);c.fillStyle='#d1c58b';c.fillRect(18,65,7,9);c.fillRect(55,65,7,9);c.fillStyle='#9ca78e';c.fillRect(5,93,70,3);c.fillStyle='#d4c7a0';c.fillRect(37,4,6,6);return true;}
    if(b.style==='pavilion'){c.fillStyle=wood;c.fillRect(6,60,w-12,4);c.fillStyle='#c8aa7e';c.fillRect(9,60,w-18,1);for(const x of [12,w-16]){c.fillStyle=wood;c.fillRect(x,30,4,30);c.fillStyle=light;c.fillRect(x,31,1,27);}const roof=b.palette==='Green'?'#738e60':'#a18459';c.fillStyle='#5f6b50';for(const [x,y,ww,hh]of [[27,5,w-54,7],[17,12,w-34,8],[8,20,w-16,9],[2,29,w-4,4]])c.fillRect(x,y,ww,hh);c.fillStyle=roof;for(const [x,y,ww,hh]of [[28,6,w-56,6],[19,13,w-38,7],[10,21,w-20,8]])c.fillRect(x,y,ww,hh);c.fillStyle='#c0b38a';c.fillRect(12,27,w-24,1);c.fillStyle='#d4c59b';c.fillRect(37,2,6,5);return true;}
    if(b.style==='stand'){for(let i=0;i<5;i++){c.fillStyle=i%2?'#a4ad94':'#b8bca3';c.fillRect(5+i*4,20+i*8,w-10-i*8,8);c.fillStyle='#7f8d7b';c.fillRect(5+i*4,27+i*8,w-10-i*8,1);}c.fillStyle=wood;c.fillRect(4,10,w-8,3);for(let x=9;x<w;x+=24)c.fillRect(x,4,3,17);c.fillStyle=light;c.fillRect(6,10,w-12,1);return true;}
    if(b.style==='greenhouse'){c.fillStyle='#5e7e68';c.fillRect(7,29,w-14,h-29);c.fillStyle='#b5c7aa';c.fillRect(10,31,w-20,h-33);for(let i=0;i<4;i++){c.fillStyle=i%2?'#aac0a6':'#91ae96';c.fillRect(10+i*19,33,18,h-35);}c.fillStyle='#769781';for(const [x,y,ww,hh]of [[37,4,22,8],[25,12,46,8],[13,20,70,10]])c.fillRect(x,y,ww,hh);c.fillStyle='#c3c9a6';for(const [x,y,ww,hh]of [[38,5,20,6],[27,13,42,6],[15,21,66,7]])c.fillRect(x,y,ww,hh);c.fillStyle=wood;for(let x=8;x<w;x+=19)c.fillRect(x,30,3,h-30);c.fillRect(7,51,w-14,3);c.fillRect(7,h-5,w-14,5);c.fillRect(40,h-25,17,25);c.fillStyle='#9eb49a';c.fillRect(43,h-22,11,19);return true;}
    if(b.style==='gardenLinked'){paintParts(c,partsFor('cottage',b.palette,80,64),0,16);paintParts(c,partsFor('cottage','Green',80,80),48,0,true);c.fillStyle=wood;c.fillRect(8,h-1,w-16,5);c.fillStyle=light;for(let x=10;x<w-8;x+=10)c.fillRect(x,h,8,1);return true;}
    return false;
  }
  function refineCustomBuilding(c,b){const [w,h]=b.size;
    if(b.style==='dome'){for(const [x,y,ww,hh]of [[28,9,24,9],[18,18,44,8],[11,26,58,12],[7,38,66,13]]){for(let px=x;px<x+ww;px++){c.fillStyle=px<28?'#a1b7a1':px<43?'#89a88e':px<57?'#748f7d':'#5c786b';c.fillRect(px,y,1,hh);}c.fillStyle='#b4c3a5';c.fillRect(x+2,y,ww-4,1);}for(const x of [25,39,53]){c.fillStyle='#c0c9aa';c.fillRect(x,27,1,23);c.fillStyle='#536f65';c.fillRect(x+1,29,1,20);}c.fillStyle='#5d7568';c.fillRect(9,51,62,5);c.fillStyle='#c5c7ab';c.fillRect(9,51,62,1);for(let y=58;y<91;y+=11){c.fillStyle='#8d9a85';c.fillRect(12,y,56,1);for(let x=12+(y%2?0:8);x<68;x+=14)c.fillRect(x,y,1,10);}for(const x of [17,54]){c.fillStyle='#5a6c60';c.fillRect(x,63,10,13);c.fillStyle='#dac994';c.fillRect(x+2,65,6,8);c.fillStyle='#f0dbaa';c.fillRect(x+3,66,2,5);}c.fillStyle='#5b6859';c.fillRect(32,74,16,20);c.fillStyle='#8d8060';c.fillRect(35,77,10,17);c.fillStyle='#c3ba90';c.fillRect(39,78,1,14);c.fillStyle='#7a8876';c.fillRect(2,92,76,4);c.fillStyle='#c4c6a8';c.fillRect(4,92,72,1);}
    if(b.style==='pavilion'){const bands=[[27,8,w-54,5],[18,15,w-36,6],[10,22,w-20,7]];for(const [x,y,ww,hh]of bands)for(let px=x+2;px<x+ww-3;px+=7){c.fillStyle=b.palette==='Green'?'#91a070':'#b3976b';c.fillRect(px,y,5,1);c.fillStyle=b.palette==='Green'?'#536e50':'#806944';c.fillRect(px+5,y+1,1,hh-1);}c.fillStyle='#4d624d66';c.fillRect(17,34,w-34,6);for(const x of [12,w-16]){c.fillStyle='#624d38';c.fillRect(x-1,35,6,3);c.fillRect(x-1,54,6,3);c.fillStyle='#d0ad77';c.fillRect(x,39,1,14);c.fillStyle='#4d5648';c.fillRect(x+2,36,1,1);}c.fillStyle='#a0835d';c.fillRect(17,51,w-34,3);for(let x=18;x<w-16;x+=10)c.fillRect(x,51,2,9);c.fillStyle='#c2a37a';c.fillRect(17,51,w-34,1);c.fillStyle='#68553f';for(let x=15;x<w-10;x+=8)c.fillRect(x,61,1,3);}
    if(b.style==='greenhouse'){for(let x=12;x<w-12;x+=19){c.fillStyle='#dee3bf';c.fillRect(x,34,1,13);c.fillRect(x+2,35,1,6);c.fillStyle='#607c65';c.fillRect(x+4,61,9,11);c.fillStyle='#7f9b6c';c.fillRect(x+1,61,15,3);c.fillStyle='#a4ad78';c.fillRect(x+4,58,3,5);c.fillRect(x+10,57,2,5);c.fillStyle='#97764f';c.fillRect(x+3,71,11,5);}for(let x=8;x<w;x+=19){c.fillStyle='#d3b583';c.fillRect(x,31,1,46);c.fillStyle='#596552';c.fillRect(x+1,51,1,1);c.fillRect(x+1,76,1,1);}c.fillStyle='#b89970';c.fillRect(8,29,w-16,3);c.fillStyle='#e0c28f';c.fillRect(10,29,w-20,1);for(const x of [32,47,62]){c.fillStyle='#d2d1aa';c.fillRect(x,20,1,9);}c.fillStyle='#5f7963';c.fillRect(41,56,15,21);c.fillStyle='#a8bea0';c.fillRect(44,58,9,16);c.fillStyle='#e0c994';c.fillRect(51,66,1,2);c.fillStyle='#837c5b';c.fillRect(36,79,26,3);c.fillStyle='#c6bb94';c.fillRect(38,79,22,1);}
    if(b.style==='arcade'){for(let x=8;x<w-4;x+=24){c.fillStyle='#6c7a68';c.fillRect(x-2,34,10,2);for(let y=41;y<60;y+=8){c.fillRect(x,y,6,1);c.fillStyle='#c5c7a7';c.fillRect(x+1,y+1,1,4);c.fillStyle='#6c7a68';}}c.fillStyle='#4f67545c';c.fillRect(16,35,w-32,4);c.fillStyle='#c0bea2';c.fillRect(5,60,w-10,1);}
    if(b.style==='stand'){for(let i=0;i<5;i++)for(let x=10+i*4;x<w-12-i*4;x+=13){c.fillStyle='#7c8b77';c.fillRect(x,22+i*8,1,5);c.fillStyle='#d0cfb0';c.fillRect(x+2,21+i*8,9,1);}for(let x=9;x<w;x+=24){c.fillStyle='#d0ac77';c.fillRect(x,5,1,15);c.fillStyle='#4f5a47';c.fillRect(x+1,12,1,1);}}
  }
  function drawDistrictGround(c){c.fillStyle='rgba(187,184,145,.44)';c.beginPath();L.terrace.polygon.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();const {center:[x,y],radius:r}=L.garden.flowerOctagon;c.fillStyle='#adab7c';c.beginPath();[[x-r,y-r/2],[x-r/2,y-r],[x+r/2,y-r],[x+r,y-r/2],[x+r,y+r/2],[x+r/2,y+r],[x-r/2,y+r],[x-r,y+r/2]].forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();c.fillStyle='#809e69';c.fillRect(x-r+10,y-r/2,r*2-20,r);c.fillRect(x-r/2,y-r+10,r,r*2-20);for(let iy=-3;iy<=3;iy++)for(let ix=-3;ix<=3;ix++){if(Math.abs(ix)+Math.abs(iy)>5)continue;c.fillStyle=(ix+iy)%2?'#e0cca0':'#d1b3a2';c.fillRect(x+ix*11,y+iy*11,3,3);}}
  function deckCell(c,cell,material){const [x,y]=sourceForCell(...cell);c.fillStyle=material==='stone'?'#a5ad98':'#9d7c55';c.fillRect(x,y,16,16);if(material==='stone'){for(let j=0;j<3;j++)for(let i=0;i<3;i++){c.fillStyle=(i+j)%2?'#bfc2aa':'#939e8d';c.fillRect(x+1+i*5,y+1+j*5,4,4);}}else{for(let yy=0;yy<16;yy+=4){c.fillStyle='#705b42';c.fillRect(x,y+yy,16,1);c.fillStyle='#c3a573';c.fillRect(x+1,y+yy+1,14,1);}c.fillStyle='#5d6252';c.fillRect(x+2,y+2,1,1);c.fillRect(x+13,y+10,1,1);}}
  function drawDecksAndStairs(c){for(const r of L.roadCells)if(r.surface==='wood')deckCell(c,r.cell,'wood');for(const b of L.bridges)for(const cell of b.deckCells)deckCell(c,cell,b.material);for(const d of L.docks)for(const cell of d.deckCells)deckCell(c,cell,d.material);for(const s of L.stairs)for(const cell of s.cells){const [x,y]=sourceForCell(...cell);for(let yy=0;yy<16;yy+=4){c.fillStyle='#c0c0a8';c.fillRect(x,y+yy,16,3);c.fillStyle='#848f7a';c.fillRect(x,y+yy+3,16,1);}}}
  function drawWall(c,w){const [x,y,ww,hh]=w.sourceRect;c.fillStyle='#6f7e68';c.fillRect(x,y,ww,hh);for(let yy=2;yy<hh;yy+=7)for(let xx=-4;xx<ww;xx+=9){c.fillStyle=(xx+yy)%2?'#a1aa90':'#89967f';c.fillRect(x+Math.max(0,xx),y+yy,Math.min(8,ww-Math.max(0,xx)),5);}c.fillStyle='#c2c2a2';c.fillRect(x,y,ww,3);c.fillStyle='#70875c';c.fillRect(x,y-1,ww,2);}
  function drawRail(c,b,front){const minX=Math.min(...b.deckCells.map(x=>x[0])),maxX=Math.max(...b.deckCells.map(x=>x[0])),minY=Math.min(...b.deckCells.map(x=>x[1])),p=sourceForCell(minX,minY),y=p[1]+(front?40:0),w=(maxX-minX+1)*16;if(b.material==='stone'){c.fillStyle='#7c8b7c';c.fillRect(p[0]+8,y-6,w-16,6);c.fillStyle='#bac1aa';c.fillRect(p[0]+8,y-7,w-16,2);for(let x=p[0]+8;x<p[0]+w-8;x+=24){c.fillStyle='#99a793';c.fillRect(x,y-12,6,12);c.fillStyle='#d1cdb1';c.fillRect(x-1,y-13,8,2);}}else{c.fillStyle='#6c573f';c.fillRect(p[0]+8,y-7,w-16,2);c.fillRect(p[0]+8,y-3,w-16,2);for(let x=p[0]+8;x<p[0]+w-8;x+=24){c.fillRect(x,y-11,3,12);c.fillStyle='#ba9b6b';c.fillRect(x,y-11,1,10);c.fillStyle='#6c573f';}}}
  function drawBoat(c,b){const [x,y]=b.sourceAnchor;shadow(c,x,y,19,5,.22);c.fillStyle='#624f3a';c.fillRect(x-7,y-24,14,37);c.fillRect(x-4,y-29,8,5);c.fillRect(x-4,y+13,8,5);c.fillStyle='#b18a5c';c.fillRect(x-5,y-23,10,35);c.fillStyle='#566b61';c.fillRect(x-3,y-20,6,28);c.fillStyle='#c2a06d';c.fillRect(x-5,y-15,10,3);c.fillRect(x-5,y+4,10,3);c.fillStyle='#ddc49a';c.fillRect(x+9,y-18,2,35);c.fillRect(x+7,y+13,6,6);}
  const groundKind=new Map();
  function buildGround(){
    for(let sy=0;sy<HEIGHT/16;sy++)for(let sx=0;sx<WIDTH/16;sx++){
      const n=hash(sx,sy),variant=n%100<5?`grassDetail${1+((n>>>9)%6)}`:'grass';sprite(gc,variant,sx*16,sy*16);
    }
    gc.fillStyle='rgba(216,214,172,.25)';gc.fillRect(0,0,WIDTH,HEIGHT);
    drawDistrictGround(gc);
    for(const r of L.roadCells)groundKind.set(r.cell.join(','),r.surface||'path');
    // Flat lawns and an inlaid stone cross preserve all 256 legacy cells.
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const cut=(x<3&&y<3)||(x>12&&y<3)||(x<3&&y>12)||(x>12&&y>12);
      const paved=(x>=5&&x<=10)||(y>=6&&y<=9)||((x===1||x===14)&&y>=3&&y<=12)||((y===1||y===14)&&x>=3&&x<=12);
      if(paved&&!cut)groundKind.set(`${x},${y}`,'cobble');
    }
    // Front-yard stone aprons are intentionally flat and remain the same walkable mask.
    for(const b of L.buildings){const [x,y]=b.entrance.cell;groundKind.set(`${x},${y}`,'cobble');}
    const terrain=A.terrain.path;
    for(const [k,kind]of groundKind){const [x,y]=k.split(',').map(Number),[px,py]=sourceForCell(x,y),n=hash(x,y);const neighbor=(dx,dy)=>groundKind.has(`${x+dx},${y+dy}`);const north=!neighbor(0,-1),south=!neighbor(0,1),west=!neighbor(-1,0),east=!neighbor(1,0);let edge='center';if(north&&west)edge='topLeft';else if(north&&east)edge='topRight';else if(south&&west)edge='bottomLeft';else if(south&&east)edge='bottomRight';else if(north)edge='top';else if(south)edge='bottom';else if(west)edge='left';else if(east)edge='right';const native=terrain.nineSliceNative;if(native.underlayPositions.includes(edge))sprite(gc,'path',px,py);sprite(gc,native.keys[edge],px,py);if(edge==='center'&&n%100<15)sprite(gc,terrain.variants[(n>>>9)%5],px,py);
      if(kind==='cobble'){
        gc.fillStyle='rgba(185,181,155,.79)';gc.fillRect(px+1,py+1,14,14);
        for(let row=0;row<3;row++)for(let col=0;col<3;col++){const shift=row%2?2:0;gc.fillStyle=(n+row+col)%3?'#c3bda3':'#a8a88e';gc.fillRect(px+2+col*5-shift,py+2+row*5,4,3);gc.fillStyle='#d5ceb4';gc.fillRect(px+2+col*5-shift,py+2+row*5,3,1);}
      }
    }
    // Medallion is painted flush with the ground: no fountain, wall or false collision in commons.
    const cx=L.commons.sourceBoundary[0]+128,cy=L.commons.sourceBoundary[1]+128;gc.fillStyle='#9b9e7e';const rings=[[40,8],[32,24],[24,32],[8,40]];for(const [rx,ry]of rings)gc.fillRect(cx-rx,cy-ry,rx*2,ry*2);gc.fillStyle='#d0c6a3';for(const [rx,ry]of [[36,6],[28,22],[22,28],[6,36]])gc.fillRect(cx-rx,cy-ry,rx*2,ry*2);gc.fillStyle='#a5aa85';gc.fillRect(cx-19,cy-19,38,38);gc.fillStyle='#dcd0ab';gc.fillRect(cx-2,cy-27,4,54);gc.fillRect(cx-27,cy-2,54,4);gc.fillStyle='#8a9573';gc.fillRect(cx-6,cy-6,12,12);gc.fillStyle='#e1d6b4';gc.fillRect(cx-2,cy-2,4,4);
    // Sparse pressed flowers, short grass, pebbles and leaf litter; all flat decoration.
    for(let y=0;y<HEIGHT/16;y++)for(let x=0;x<WIDTH/16;x++){
      const n=hash(x+77,y-19),wx=x-32,wy=y-32,k=`${wx},${wy}`;
      if(groundKind.has(k)||solids.has(k)||L.water.some(w=>w.source[0]===x*16&&w.source[1]===y*16))continue;
      const inCommons=wx>=0&&wx<16&&wy>=0&&wy<16;
      if(n%100<(inCommons?27:10)){
        const px=x*16+3+(n%8),py=y*16+4+((n>>>8)%7);gc.fillStyle=inCommons?'#d8c99c':'#a4aa66';gc.fillRect(px,py,2,1);gc.fillRect(px+5,py+4,2,1);gc.fillStyle='#6d934f';gc.fillRect(px+1,py+2,1,2);
        if(n%3===0){gc.fillStyle='#e8dba9';gc.fillRect(px+5,py+2,2,2);gc.fillStyle='#d4b85e';gc.fillRect(px+6,py+3,1,1);}
      }
      if(!inCommons&&n%100<4)sprite(gc,'grassClump',x*16,y*16);
    }
    // Stepped river bank: native source foam on the water side and exposed sand shoulders.
    const waterSet=new Set(L.water.map(w=>w.source.join(',')));
    for(const w of L.water){const [x,y]=w.source;sprite(gc,'water',x,y);if(!waterSet.has(`${x-16},${y}`)){gc.fillStyle='#beb781';gc.fillRect(x-4,y,4,16);sprite(gc,'waterShoreFoam',x-4,y+4,{rotate90:true});}if(!waterSet.has(`${x+16},${y}`)){gc.fillStyle='#c8bd86';gc.fillRect(x+16,y,4,16);sprite(gc,'waterShoreFoam',x+5,y+4,{rotate90:true,flipY:true});}if(!waterSet.has(`${x},${y-16}`)&&y>0)sprite(gc,'waterShoreFoam',x,y);if(!waterSet.has(`${x},${y+16}`)&&y<HEIGHT-16)sprite(gc,'waterShoreFoam',x,y+9,{flipY:true});}
    drawDecksAndStairs(gc);
    // Tiny age marks make paths feel used without becoming a noisy grid.
    for(const [k]of groundKind){const [x,y]=k.split(',').map(Number),n=hash(x+2,y+5);if(n%100>24)continue;const [px,py]=sourceForCell(x,y);gc.fillStyle='#9d916f';gc.fillRect(px+3+(n%5),py+11,2,1);gc.fillStyle='#d9c89d';gc.fillRect(px+8,py+4,2,1);}
  }
  function drawFixture(c,p){const [x,y]=p.groundAnchor;if(p.type==='fenceHorizontal'){c.fillStyle='#72573e';c.fillRect(x-7,y-13,3,13);c.fillRect(x+5,y-13,3,13);c.fillStyle='#aa875c';c.fillRect(x-8,y-11,16,3);c.fillRect(x-8,y-6,16,3);c.fillStyle='#d0aa74';c.fillRect(x-8,y-11,16,1);c.fillRect(x-8,y-6,16,1);c.fillRect(x-7,y-13,3,1);c.fillRect(x+5,y-13,3,1);return;}if(A.modules[p.type]){const m=A.modules[p.type];for(const part of m.parts)sprite(c,part.sprite,x-m.groundAnchor[0]+part.offset[0],y-m.groundAnchor[1]+part.offset[1],part);return;}
    if(p.type==='lamp'){c.fillStyle='#5f6150';c.fillRect(x-2,y-23,4,23);c.fillStyle='#b5a875';c.fillRect(x-1,y-22,1,21);c.fillStyle='#63523e';c.fillRect(x-6,y-25,12,3);c.fillRect(x-5,y-23,10,8);c.fillStyle='#e5c683';c.fillRect(x-3,y-22,6,5);c.fillStyle='#f2d79c';c.fillRect(x-2,y-22,2,4);c.fillStyle='#615a43';c.fillRect(x-4,y-1,8,2);}
    if(p.type==='terminal'){c.fillStyle='#777b6a';c.fillRect(x-5,y-11,10,11);c.fillStyle='#c8c3a2';c.fillRect(x-6,y-18,12,12);c.fillStyle='#506c64';c.fillRect(x-4,y-16,8,6);c.fillStyle='#b4d1aa';c.fillRect(x-2,y-14,4,1);c.fillRect(x-2,y-12,2,1);c.fillStyle='#9e9f83';c.fillRect(x-6,y-2,12,2);}
    if(p.type==='notice'){c.fillStyle='#775b3e';c.fillRect(x-8,y-27,16,17);c.fillRect(x-6,y-10,2,10);c.fillRect(x+4,y-10,2,10);c.fillStyle='#c2af75';c.fillRect(x-6,y-25,12,13);c.fillStyle='#eee0b3';c.fillRect(x-5,y-23,6,8);c.fillStyle='#8a8e67';c.fillRect(x-3,y-21,3,1);c.fillRect(x-3,y-18,2,1);}
    if(p.type==='planter'){c.fillStyle='#82694e';c.fillRect(x-8,y-7,16,7);c.fillStyle='#b39968';c.fillRect(x-9,y-8,18,2);c.fillStyle='#5f8752';c.fillRect(x-6,y-12,12,5);c.fillStyle='#8da069';c.fillRect(x-8,y-11,16,2);c.fillStyle='#e5c792';c.fillRect(x-3,y-13,2,2);c.fillRect(x+4,y-11,2,2);}
  }

  for(const b of L.buildings)makeBuildingArt(b);buildGround();
  const objects=[...L.retainingWalls.map(w=>({kind:'wall',id:'wall-'+w.cell.join(','),x:w.sourceRect[0],y:w.sourceRect[1]+24,draw:c=>drawWall(c,w)})),...L.bridges.flatMap(b=>[false,true].map(front=>({kind:'rail',id:b.id+'-'+front,x:point(...b.deckCells[0])[0],y:point(...b.deckCells[0])[1]+(front?32:-8),draw:c=>drawRail(c,b,front)}))),...L.boats.map(b=>({kind:'boat',id:b.id,x:b.sourceAnchor[0],y:b.sourceAnchor[1],draw:c=>drawBoat(c,b)})),...L.buildings.map(b=>({kind:'building',id:b.id,x:b.groundAnchor[0],y:b.groundAnchor[1],draw(c){c.drawImage(buildingArt.get(b.id),...b.topLeft);}})),...L.props.map(p=>({kind:'prop',id:p.id,x:p.groundAnchor[0],y:p.groundAnchor[1],draw:c=>drawFixture(c,p)}))];
  for(const b of L.buildings)shadow(gc,b.topLeft[0]+b.size[0]/2,b.groundAnchor[1],b.size[0]-8,8,.19);
  for(const p of L.props)shadow(gc,...p.groundAnchor,p.type.startsWith('tree')?23:14,5,.16);
  return{ground,objects,drawLamps(c,amount){if(!(amount>0))return;for(const p of L.props)if(p.type==='lamp'){const [x,y]=p.groundAnchor;c.fillStyle=`rgba(255,192,95,${.12*amount})`;c.fillRect(x-16,y-33,32,22);c.fillRect(x-10,y-39,20,34);c.fillStyle=`rgba(255,214,138,${amount})`;c.fillRect(x-3,y-22,6,5);}},dispose(){ground.width=0;for(const art of buildingArt.values())art.width=0;buildingArt.clear();}};
}
