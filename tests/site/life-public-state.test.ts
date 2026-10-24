import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser public projection is plain JavaScript.
import {readPublicLifeActivity,publicLifeLabel} from '../../apps/web/public/hud/life-public-state.js';
const activity={activityId:'own-fixture-activity',actionId:'work.shift',state:'active',placeId:'harbor_work',placeName:'码头工作区',startedAt:1000,scheduledEndAt:601000};
test('public life activity names the actual phase without money, private energy or route fields',()=>{
 assert.deepEqual(readPublicLifeActivity(activity),activity);assert.equal(publicLifeLabel(activity),'正在工作 · 码头工作区');for(const field of ['coinReward','energy','route','ownerAudience'])assert.throws(()=>readPublicLifeActivity({...activity,[field]:'private'}));assert.equal(readPublicLifeActivity(null),null);assert.equal(publicLifeLabel(null),'当前活动尚未提供');assert.throws(()=>readPublicLifeActivity({...activity,actionId:'fish.session'}));
});
