import colors from './appearance-colors-v1.json' with {type:'json'};

// Metadata is the same finite data file exposed by the appearance API.
export const APPEARANCE_COLORS=colors;
export const paletteOptions=kind=>colors[kind==='hair'?'hairColors':'clothingColors'];
const options={hair:new Map(colors.hairColors.map(row=>[row.id,row])),clothing:new Map(colors.clothingColors.map(row=>[row.id,row]))};
const rgb=hex=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16));
const clamp=value=>Math.max(0,Math.min(255,Math.round(value)));
const hairSources={
 shorthair:{shades:[[62,39,49],[93,59,74]],ramp:[.65,1]},
 longhair:{shades:[[96,54,47],[148,70,38],[186,78,42],[225,116,24],[246,147,69]],ramp:[.38,.61,.8,1,1.22]},
 curlyhair:{shades:[[62,39,49],[98,53,48],[148,85,66]],ramp:[.48,.75,1.1]},
 bowlhair:{shades:[[62,39,49],[117,61,58],[187,109,83],[200,127,91]],ramp:[.4,.65,1,1.16]},
 mophair:{shades:[[145,64,45],[190,74,47],[197,129,88],[211,99,73]],ramp:[.61,.9,1,1.16]},
 spikeyhair:{shades:[[162,38,51],[228,59,68],[237,82,89]],ramp:[.65,1,1.15]},
};
const clothingSource={shades:[[36,43,66],[55,68,100]],ramp:[.62,1]};
function nearest(pixel,shades){let best=-1,distance=Infinity;for(let i=0;i<shades.length;i++){const d=shades[i].reduce((sum,v,c)=>sum+(v-pixel[c])**2,0);if(d<distance){distance=d;best=i;}}return distance<=12?best:-1;}
// Only known source RGB values are mapped. Skin, outlines, scarf and alpha stay byte-identical.
export function recolorAppearancePixels(data,kind,colorId='original',hair='longhair'){
  const option=options[kind]?.get(colorId);if(!option||colorId==='original')return data;
  const target=rgb(option.swatch),source=kind==='hair'?hairSources[hair]:clothingSource;if(!source)return data;
  for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const shade=nearest(data.subarray(i,i+3),source.shades);if(shade<0)continue;const factor=source.ramp[shade];for(let c=0;c<3;c++)data[i+c]=clamp(factor<=1?target[c]*factor:target[c]+(255-target[c])*(factor-1));}
  return data;
}
const cache=new WeakMap();
export function appearanceLayer(image,kind,colorId='original',sourceKey=''){
  if(!image||colorId==='original'||!options[kind]?.has(colorId))return image;
  let variants=cache.get(image);if(!variants){variants=new Map();cache.set(image,variants);}const key=kind+':'+colorId;if(variants.has(key))return variants.get(key);
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height),hair=(sourceKey||image.currentSrc||image.src||'').match(/(?:human[_-])?(shorthair|longhair|curlyhair|bowlhair|mophair|spikeyhair)/)?.[1];recolorAppearancePixels(pixels.data,kind,colorId,hair);context.putImageData(pixels,0,0);variants.set(key,canvas);return canvas;
}
export function appearanceColors(appearance){return{hairColorId:options.hair.has(appearance?.hairColorId)?appearance.hairColorId:'original',clothingColorId:options.clothing.has(appearance?.clothingColorId)?appearance.clothingColorId:'original'};}
