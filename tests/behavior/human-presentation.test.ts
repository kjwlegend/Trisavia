import test from 'node:test';
import assert from 'node:assert/strict';
import {BEHAVIOR_TEMPLATE_CATALOG,validateBehaviorTemplateLeaf,templateDictionaryKey,formatBehaviorTemplateParams} from '../../apps/web/public/hud/behavior-human-contract.js';

test('one bounded human template catalog validates every exact definition and keeps unknown versions distinct from bad parameters',()=>{
 const ids=Object.keys(BEHAVIOR_TEMPLATE_CATALOG);assert(ids.length>0&&ids.length<=320);
 for(const id of ids){const definition=BEHAVIOR_TEMPLATE_CATALOG[id]!,params=Object.fromEntries(Object.entries(definition.params).map(([key,rule])=>[key,rule.kind==='text'?'原样名称':rule.kind==='integer'?rule.minimum:[{name:'原样物品',quantity:1,role:rule.roles[0]}]])),leaf={kind:'template',templateId:id,templateVersion:1,paramsSnapshot:params};assert.equal(validateBehaviorTemplateLeaf(leaf).known,true,id);assert.equal(templateDictionaryKey(id,1),definition.dictionaryKey);assert.equal(definition.field,id.split('.').at(-1));assert(Object.isFrozen(definition.params));}
 const id='behavior.owner.life.purchase.completed.named.amount.result',valid={kind:'template' as const,templateId:id,templateVersion:1,paramsSnapshot:{place:'原地点',items:[{name:'原物品',quantity:1,role:'bought'}],amount:30}};
 assert.equal(validateBehaviorTemplateLeaf(valid).known,true);assert.match(String(formatBehaviorTemplateParams(valid,'en').items),/原物品.*1/);
 for(const paramsSnapshot of [{...valid.paramsSnapshot,extra:true},{...valid.paramsSnapshot,amount:-1},{...valid.paramsSnapshot,amount:null},{...valid.paramsSnapshot,items:[{name:'原物品',quantity:0,role:'bought'}]},{...valid.paramsSnapshot,items:[{name:'原物品',quantity:1,role:'sold'}]},{...valid.paramsSnapshot,items:[{name:'原物品',quantity:1,role:'bought',hidden:'extra'}]},{...valid.paramsSnapshot,place:'<script>'}])assert.throws(()=>validateBehaviorTemplateLeaf({...valid,paramsSnapshot}),TypeError);
 assert.deepEqual(validateBehaviorTemplateLeaf({...valid,templateVersion:2}),{known:false});assert.equal(templateDictionaryKey(id,2),null);
 assert.deepEqual(validateBehaviorTemplateLeaf({kind:'template',templateId:'behavior.future.result',templateVersion:1,paramsSnapshot:{count:1}}),{known:false});
 for(const leaf of [{kind:'template',templateId:'behavior.future.result',templateVersion:1,paramsSnapshot:{nested:{private:'value'}}},{...valid,templateVersion:0},{...valid,templateId:'not a semantic ID'},{...valid,hidden:true}])assert.throws(()=>validateBehaviorTemplateLeaf(leaf),TypeError);
});
