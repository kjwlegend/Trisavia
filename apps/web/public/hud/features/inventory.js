import {createPlatformInventory} from './platform-content.js';
export function createInventoryFeature(_provider,_onEnterDemo,options={}){
  const feature=createPlatformInventory(options.worldProvider,options);feature.node.id='hud-feature-inventory';feature.node.classList.add('hud-feature');return feature;
}
