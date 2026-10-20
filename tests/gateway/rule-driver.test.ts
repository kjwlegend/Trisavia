import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {createWorldRuleDriver} from '../../apps/platform/application/world-rule-driver.ts';
test('rule driver never overlaps runs and drains the accepted run before closing its worker',async()=>{
 let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;}),order:string[]=[];let runs=0;
 const driver=createWorldRuleDriver({async runDue(){runs++;order.push('run');entered();await blocked;order.push('done');},async close(){order.push('close');}},100);
 driver.start();driver.start();await started;await delay(130);assert.equal(runs,1);let closed=false;const closing=driver.close().then(()=>{closed=true;});await delay(20);assert.equal(closed,false);release();await closing;assert.deepEqual(order,['run','done','close']);await delay(130);assert.equal(runs,1);
});
