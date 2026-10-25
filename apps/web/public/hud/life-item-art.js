import manifest from '../world-life/b/assets-manifest.json' with {type:'json'};
import extra from '../world-life/c/assets-manifest.json' with {type:'json'};
import {el} from '../common.js';
const items=new Map([...manifest.items.map(item=>[item.itemId,{...item,url:'/assets/world-life/b/'+item.sprite.path}]),...extra.items.map(item=>[item.itemId,{...item,url:'/assets/world-life/c/'+item.sprite.path}])]);
export const LIFE_ITEM_IDS=Object.freeze([...items.keys()]);
export function lifeItemArt(itemId){const item=items.get(itemId);return item?{...item}:null;}
export function lifeItemFromRef(ref){return ref?.moduleId==='items'&&ref.type==='items.item@1'&&typeof ref.id==='string'&&ref.id.startsWith('life.')&&items.has(ref.id.slice(5))?ref.id.slice(5):null;}
export function lifeItemImage(itemId,className='life-item-image'){
 const item=lifeItemArt(itemId);if(!item)return null;
 const image=el('img',className);image.src=item.url;image.width=image.height=32;image.alt='';image.style.imageRendering='pixelated';image.addEventListener('error',()=>{image.hidden=true;});return image;
}
