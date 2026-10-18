import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {createPanelTransition} from '../../apps/web/public/hud/panel-transition.js';

function animation(){
 let finish!:()=>void,start!:()=>void;
 const ready=new Promise<void>(resolve=>{start=resolve;});
 const finished=new Promise<void>(resolve=>{finish=resolve;});
 // An already queued completion may still arrive after cancellation.
 return{ready,start,finished,finish,cancel(){}};
}
async function start(value:ReturnType<typeof animation>){value.start();await value.ready;await Promise.resolve();}
function panel(){
 let hidden=true;
 const hiddenWrites:boolean[]=[],animations:Array<ReturnType<typeof animation>>=[],attributes=new Map<string,string>();
 return{
  get hidden(){return hidden;},set hidden(value:boolean){hidden=value;hiddenWrites.push(value);},
  inert:false,style:{pointerEvents:''},dataset:{panelState:''},hiddenWrites,animations,attributes,
  setAttribute(name:string,value:string){attributes.set(name,value);},
  animate(){const next=animation();animations.push(next);return next;},
 };
}
function media(matches=false){
 const listeners=new Set<()=>void>();
 return{
  matches,
  addEventListener(_name:string,listener:()=>void){listeners.add(listener);},
  removeEventListener(_name:string,listener:()=>void){listeners.delete(listener);},
  change(value:boolean){this.matches=value;for(const listener of [...listeners])listener();},
 };
}
function timers(){
 let sequence=0;
 const pending=new Map<number,()=>void>(),issued=new Map<number,()=>void>();
 return{
  setTimer(callback:()=>void){const id=++sequence;pending.set(id,callback);issued.set(id,callback);return id;},
  clearTimer(id:number|null){if(id!==null)pending.delete(id);},
  // Fire even a cancelled callback to represent one already queued by the browser.
  fire(id:number){const callback=issued.get(id);assert.ok(callback);pending.delete(id);callback();},
  get latest(){return sequence;},get pendingCount(){return pending.size;},
 };
}
function fixture(reduced=false){
 const node=panel(),motion=media(reduced),clock=timers();
 const transition=createPanelTransition(node,{motion,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
 return{node,motion,clock,transition};
}
function state(value:ReturnType<typeof fixture>,expected:string,hidden:boolean,inert:boolean){
 assert.equal(value.transition.state,expected);assert.equal(value.node.dataset.panelState,expected);
 assert.equal(value.node.hidden,hidden);assert.equal(value.node.inert,inert);
 assert.equal(value.node.style.pointerEvents,inert?'none':'');
 assert.equal(value.node.attributes.get('aria-hidden'),String(inert));
}

test('the real panel driver keeps the closing shell visible and isolates completed or timed-out closes from a reopened host',async()=>{
 const current=fixture(),{node,clock,transition}=current;
 const opening=transition.show();state(current,'opening',false,false);
 await start(node.animations.at(-1)!);node.animations.at(-1)!.finish();assert.equal(await opening,true);state(current,'open',false,false);

 const closing=transition.hide(),repeatedClose=transition.hide();state(current,'closing',false,true);
 const closeAnimation=node.animations.at(-1)!;await start(closeAnimation);
 const closeTimer=clock.latest,hiddenBefore=node.hiddenWrites.filter(Boolean).length;
 assert.equal(node.animations.length,2,'Repeated close keeps the existing transition');
 closeAnimation.finish();assert.equal(await closing,true);assert.equal(await repeatedClose,true);
 state(current,'closed',true,true);clock.fire(closeTimer);
 assert.equal(node.hiddenWrites.filter(Boolean).length,hiddenBefore+1,'Animation and fallback have one terminal hide');

 const reopen=transition.show();await start(node.animations.at(-1)!);node.animations.at(-1)!.finish();assert.equal(await reopen,true);
 const oldClose=transition.hide(),oldAnimation=node.animations.at(-1)!;await start(oldAnimation);const oldTimer=clock.latest;
 const newPanel=transition.show(),newAnimation=node.animations.at(-1)!,count=node.animations.length;
 await start(newAnimation);
 assert.equal(await oldClose,false);state(current,'opening',false,false);
 const sameHost=transition.show();assert.equal(node.animations.length,count,'Repeated show does not restart the current host transition');
 oldAnimation.finish();clock.fire(oldTimer);await Promise.resolve();
 state(current,'opening',false,false);
 newAnimation.finish();assert.equal(await newPanel,true);assert.equal(await sameHost,true);state(current,'open',false,false);

 const fallbackClose=transition.hide(),lateAnimation=node.animations.at(-1)!;await start(lateAnimation);const fallback=clock.latest;
 const beforeFallback=node.hiddenWrites.filter(Boolean).length;
 state(current,'closing',false,true);clock.fire(fallback);
 assert.equal(await fallbackClose,true);state(current,'closed',true,true);
 lateAnimation.finish();await Promise.resolve();
 assert.equal(node.hiddenWrites.filter(Boolean).length,beforeFallback+1,'A late animation cannot repeat the fallback cleanup');
 assert.equal(clock.pendingCount,0);transition.destroy();
});

test('reduced motion reaches visible or hidden terminal states immediately and invalidates interrupted animation callbacks',async()=>{
 const current=fixture(true),{node,motion,clock,transition}=current;
 const shown=transition.show();state(current,'open',false,false);assert.equal(await shown,true);
 const hidden=transition.hide();state(current,'closed',true,true);assert.equal(await hidden,true);
 assert.equal(node.animations.length,0);assert.equal(clock.pendingCount,0);

 motion.change(false);
 const opening=transition.show(),oldOpen=node.animations.at(-1)!;await start(oldOpen);const oldOpenTimer=clock.latest;
 state(current,'opening',false,false);motion.change(true);
 state(current,'open',false,false);assert.equal(await opening,true);assert.equal(clock.pendingCount,0);

 motion.change(false);
 const closing=transition.hide(),oldClose=node.animations.at(-1)!;await start(oldClose);const oldCloseTimer=clock.latest;
 state(current,'closing',false,true);motion.change(true);
 state(current,'closed',true,true);assert.equal(await closing,true);assert.equal(clock.pendingCount,0);
 assert.equal(await transition.show(),true);state(current,'open',false,false);
 oldOpen.finish();oldClose.finish();clock.fire(oldOpenTimer);clock.fire(oldCloseTimer);await Promise.resolve();
 state(current,'open',false,false);assert.equal(clock.pendingCount,0);transition.destroy();
});

test('native ready gates the fallback and late readiness cannot arm a cancelled, reduced or destroyed transition',async()=>{
 const current=fixture(),{node,motion,clock,transition}=current;
 const opening=transition.show(),firstOpen=node.animations.at(-1)!;
 assert.equal(clock.pendingCount,0,'Creating an autoplay animation does not mean playback has started');
 await start(firstOpen);const firstTimer=clock.latest;firstOpen.finish();assert.equal(await opening,true);

 const closing=transition.hide(),waitingClose=node.animations.at(-1)!,issuedBeforeReady=clock.latest;
 state(current,'closing',false,true);
 assert.equal(clock.pendingCount,0,'No wall-clock hide is armed while native autoplay is still pending');
 clock.fire(firstTimer);await Promise.resolve();state(current,'closing',false,true);
 assert.equal(clock.latest,issuedBeforeReady);
 await start(waitingClose);assert.equal(clock.pendingCount,1,'The live close gains a fallback only after native ready');
 clock.fire(clock.latest);assert.equal(await closing,true);state(current,'closed',true,true);

 const reopen=transition.show();await start(node.animations.at(-1)!);node.animations.at(-1)!.finish();assert.equal(await reopen,true);
 const cancelledClose=transition.hide(),cancelledAnimation=node.animations.at(-1)!;
 const replacement=transition.show(),replacementAnimation=node.animations.at(-1)!,beforeLateReady=clock.latest;
 assert.equal(await cancelledClose,false);state(current,'opening',false,false);
 await start(cancelledAnimation);cancelledAnimation.finish();await Promise.resolve();
 assert.equal(clock.latest,beforeLateReady,'Old ready cannot install a timer for the new host');
 assert.equal(clock.pendingCount,0);state(current,'opening',false,false);
 await start(replacementAnimation);replacementAnimation.finish();assert.equal(await replacement,true);state(current,'open',false,false);

 const reducedClose=transition.hide(),reducedAnimation=node.animations.at(-1)!,beforeReducedReady=clock.latest;
 motion.change(true);assert.equal(await reducedClose,true);state(current,'closed',true,true);
 await start(reducedAnimation);reducedAnimation.finish();await Promise.resolve();
 assert.equal(clock.latest,beforeReducedReady);assert.equal(clock.pendingCount,0);state(current,'closed',true,true);

 motion.change(false);
 const destroyedOpen=transition.show(),destroyedAnimation=node.animations.at(-1)!,beforeDestroyReady=clock.latest;
 transition.destroy();assert.equal(await destroyedOpen,false);
 const afterDestroy={hidden:node.hidden,inert:node.inert,pointerEvents:node.style.pointerEvents,state:transition.state};
 await start(destroyedAnimation);destroyedAnimation.finish();await Promise.resolve();
 assert.equal(clock.latest,beforeDestroyReady);assert.equal(clock.pendingCount,0);
 assert.deepEqual({hidden:node.hidden,inert:node.inert,pointerEvents:node.style.pointerEvents,state:transition.state},afterDestroy);
});
