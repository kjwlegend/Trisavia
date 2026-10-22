import {APPEARANCE_CATALOG} from './look.js';
export function nativeFrame(style='darkWood'){
  const node=document.createElement('div');node.className='native-frame';node.setAttribute('aria-hidden','true');
  const frame=APPEARANCE_CATALOG.ui.nineSlice[style];if(!frame)throw new Error('native_frame_unknown');
  for(const key of ['tl','tc','tr','lc','c','rc','bl','bc','br']){const image=document.createElement('img');image.src=new URL(APPEARANCE_CATALOG.images[frame.pieces[key]].url,import.meta.url);image.alt='';node.append(image);}return node;
}
export function selectionCorners(){const node=document.createElement('span');node.className='native-selection-corners';node.setAttribute('aria-hidden','true');for(const key of APPEARANCE_CATALOG.ui.selection.cornerKeys){const image=document.createElement('img');image.src=new URL(APPEARANCE_CATALOG.images[key].url,import.meta.url);image.alt='';node.append(image);}return node;}
