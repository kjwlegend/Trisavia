// Both hosts inherit the same safe rectangle, measured from the real header
// and toolbar rather than from a guessed right-hand reading lane.
export function createPanelLayout(root,dock,header){
  function update(){
    const box=root.getBoundingClientRect(),top=Math.max(88,(header?.getBoundingClientRect().bottom||box.top+64)-box.top+16);
    const bottom=Math.max(top+44,dock.getBoundingClientRect().top-box.top-40);
    for(const [key,value]of Object.entries({'--world-panel-top':`${top}px`,'--world-panel-center-y':`${(top+bottom)/2}px`,'--world-panel-width':`${Math.max(0,box.width-48)}px`,'--world-panel-height':`${bottom-top}px`})){
      if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);
    }
  }
  const observer=new ResizeObserver(update);observer.observe(root);observer.observe(dock);if(header)observer.observe(header);update();
  return{update,destroy:()=>observer.disconnect()};
}
