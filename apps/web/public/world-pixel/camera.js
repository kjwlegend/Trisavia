export function pixelFitScale(stage,viewport,insets={}){
  const width=viewport.width-(insets.left||0)-(insets.right||0),height=viewport.height-(insets.top||0)-(insets.bottom||0);
  if(!(width>0&&height>0&&stage.width>0&&stage.height>0))return .01;
  return Math.max(.01,Math.min(width/stage.width,height/stage.height));
}
// Fit and manual views share the same source-pixel scale, including fractions.
export function nextPixelScale(current,direction,fit){
  if(!direction)return current;
  return Math.max(Math.min(fit,3),Math.min(3,Math.round((current+Math.sign(direction)*.1)*1e9)/1e9));
}
