import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser text helper is plain JavaScript.
import {buildWorkRestIntent,buildBenchRestIntent} from '../../apps/web/public/hud/life-intent.js';
test('work/rest copy remains four bounded steps with live capabilities and original unknown-result recovery',()=>{
 const value=buildWorkRestIntent({origin:'https://world.invalid/path?ignore=secret',agentLabel:'样本 A001',job:{id:'harbor_shift',name:'码头短工',placeName:'盐风仓棚',durationSeconds:600},rest:{placeName:'花径凉亭',durationSeconds:300,price:0}});
 assert.match(value,/https:\/\/world.invalid\/v1\/capabilities/u);assert.match(value,/一班工作、一次免费休息，支出预算0星币/u);assert.match(value,/先查原回执，不重复开始/u);assert.equal((value.match(/\n[1-4]\. /gu)||[]).length,4);assert.doesNotMatch(value,/ignore=secret|\/gateway\/commands|ownerId|sessionToken/u);assert.throws(()=>buildWorkRestIntent({origin:'https://world.invalid',job:{id:'x',name:'x',placeName:'x',durationSeconds:1},rest:{placeName:'x',durationSeconds:1,price:12}}));
});

test('free recovery copy does not add work, paid rest or more than one activity',()=>{
 const value=buildBenchRestIntent({origin:'https://world.invalid',agentLabel:'样本 A001',rest:{placeName:'花径凉亭',durationSeconds:300,price:0}});
 assert.equal((value.match(/\n[1-4]\. /gu)||[]).length,4);assert.match(value,/已满体力或已有身体活动则停止/u);assert.match(value,/不代接工作或追加其他活动/u);assert.match(value,/一次免费休息，支出预算0星币/u);
});
