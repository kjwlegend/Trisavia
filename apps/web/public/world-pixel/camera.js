export function pixelFitScale(stage,viewport,insets={}){
  const width=viewport.width-(insets.left||0)-(insets.right||0),height=viewport.height-(insets.top||0)-(insets.bottom||0);
  if(!(width>0&&height>0&&stage.width>0&&stage.height>0))return .01;
  return Math.max(.01,Math.min(width/stage.width,height/stage.height));
}
// Fit can be fractional. Deliberate close views use native 2x/3x source pixels.
export function nextPixelScale(current,direction,fit){
  if(!direction)return current;
  const levels=[...new Set([Math.min(fit,3),2,3])].sort((a,b)=>a-b);
  return direction>0?levels.find(value=>value>current+.001)??levels.at(-1):[...levels].reverse().find(value=>value<current-.001)??levels[0];
}
