// Data and actual-renderer DOM only: no browser, HTTP, production build, identity or database.
import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Player-facing browser data module.
import {BOARD_COLUMNS,MAP_CARDS,LIFE_CARDS,WORLD_INTRODUCTION} from '../../apps/web/public/kanban-data.js';
// @ts-expect-error Player-facing release data module.
import {RELEASES} from '../../apps/web/public/releases-data.js';

const firstVersions:Record<string,string>={
 'map-atlas':'0.2.0',
 'life-work-shift':'0.3.0','life-bench-rest':'0.3.0','life-work-rest-plan':'0.3.0','life-npc-routines':'0.3.0','life-diary':'0.3.0',
 'life-custom-avatar':'0.4.0',
 'life-shop-goods':'0.5.0','life-sea-fishing':'0.5.0','life-sell-fish':'0.5.0',
 'life-tavern-meals':'0.6.0','life-paid-lodge-rest':'0.6.0','life-bookhouse-reading':'0.6.0','life-scenic-visits':'0.6.0','life-friend-gifts':'0.6.0',
 'life-map-expressions':'0.7.0','life-runtime-rules':'0.7.1','life-autonomous-choices':'0.8.0','life-current-activity':'0.8.1','life-garden-care':'0.9.0',
 'life-private-journal':'0.10.0','life-npc-stories':'0.10.0','life-place-profiles':'0.10.2',
};
test('delivered roadmap preserves four future places, first versions and private journal scope',()=>{
 const cards=[...MAP_CARDS,...LIFE_CARDS],ids=cards.map(card=>card.id),byId=(id:string)=>cards.find(card=>card.id===id);
 assert.equal(cards.length,28);assert.equal(new Set(ids).size,cards.length);
 assert.deepEqual(BOARD_COLUMNS.map((c:any)=>c.title),['投票','未来','进行中','已完成']);
 assert.deepEqual(MAP_CARDS.map((c:any)=>[c.id,c.column]),[['map-atlas','completed'],['map-sunset-bay','planned'],['map-plain-outpost','planned'],['map-dawn-lake','planned'],['map-mist-valley','planned']]);
 assert.equal(cards.filter(c=>c.column==='completed').length,23);assert.deepEqual(cards.filter(c=>c.column==='in-progress').map(c=>c.id),['world-startup-performance']);assert.equal(cards.filter(c=>c.column==='voting').length,0);
 for(const c of cards){assert(BOARD_COLUMNS.some((column:any)=>column.id===c.column));assert(c.title&&c.summary&&c.scope);if(c.column==='completed'){assert.equal(c.completedVersion,firstVersions[c.id]);assert(RELEASES.some((r:any)=>r.version===c.completedVersion));assert.doesNotMatch(c.scope,/本地|尚未开放/);}else assert.equal(c.completedVersion,undefined);}
 assert.deepEqual(Object.keys(firstVersions).sort(),cards.filter(c=>c.column==='completed').map(c=>c.id).sort());
 assert.equal(byId('life-more-npc-routines'),undefined);assert.match(byId('life-npc-routines').summary,/首批四位.*v0\.6\.0.*七位/);
 assert.match(byId('life-diary').summary,/实际结果.*获准历史.*最近 10 条获准公开/);assert.match(byId('life-private-journal').summary,/私人手记不会成为公开经历/);
 assert.match(byId('life-custom-avatar').summary,/参考与草稿私有.*已应用形象按公开范围展示/);assert.match(byId('life-friend-gifts').summary,/只有对方 Agent 明确接受后/);
 assert.match(byId('world-startup-performance').summary,/尚未达到预期目标/);assert.match(WORLD_INTRODUCTION.scope,/具体可体验内容以当前站点为准/);assert.doesNotMatch(WORLD_INTRODUCTION.scope,/仅本地|验收|所有环境/);
});

class Element {
 className='';textContent='';dataset:Record<string,string>={};attributes:Record<string,string>={};children:Element[]=[];following:Element[]=[];
 tagName:string;
 constructor(tagName:string){this.tagName=tagName;}
 append(...nodes:Element[]){this.children.push(...nodes);}
 after(node:Element){this.following.push(node);}
 setAttribute(name:string,value:string){this.attributes[name]=value;}
}
test('kanban renders completed versions newest first, preserving ties and the other column order',async()=>{
 const intro=new Element('section'),board=new Element('div'),previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>new Element(tag),querySelector:(selector:string)=>selector==='#world-introduction'?intro:selector==='#map-board'?board:null}});
 try{const renderer='../../apps/web/public/kanban.js';await import(renderer);}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
 assert.deepEqual(board.children.map(c=>c.dataset.column),['voting','planned','in-progress','completed']);
 const rows=(column:string)=>board.children.find(c=>c.dataset.column===column)!.children.filter(c=>c.className==='paper-sheet board-card');
 assert.deepEqual(rows('planned').map(c=>c.dataset.card),['map-sunset-bay','map-plain-outpost','map-dawn-lake','map-mist-valley']);assert.deepEqual(rows('in-progress').map(c=>c.dataset.card),['world-startup-performance']);
 assert.deepEqual(rows('completed').map(c=>c.dataset.card),[
  'life-place-profiles','life-private-journal','life-npc-stories','life-garden-care','life-current-activity','life-autonomous-choices','life-runtime-rules','life-map-expressions',
  'life-tavern-meals','life-paid-lodge-rest','life-bookhouse-reading','life-scenic-visits','life-friend-gifts','life-shop-goods','life-sea-fishing','life-sell-fish','life-custom-avatar',
  'life-work-shift','life-bench-rest','life-work-rest-plan','life-npc-routines','life-diary','map-atlas',
 ]);
 const cards=[...MAP_CARDS,...LIFE_CARDS];for(const section of board.children){assert(section.dataset.column);for(const row of rows(section.dataset.column)){const card=cards.find(c=>c.id===row.dataset.card),[title,summary,scope]=row.children;assert(card&&title&&summary&&scope);assert.equal(title.textContent,card.title);assert.equal(summary.textContent,card.summary);assert.equal(scope.textContent,card.column==='completed'?`${card.scope} · v${card.completedVersion}`:card.scope);}}
 const voting=board.children[0];assert(voting&&voting.children[0]);assert.match(voting.children.at(-1)!.textContent,/暂未开放投票/);assert.equal(voting.children[0].children.length,1,'No fabricated vote count');assert.equal(rows('voting').length,0);
 assert.equal(rows('completed').filter(c=>c.children.some(n=>n.tagName==='a')).length,1);assert.equal(rows('completed').find(c=>c.dataset.card==='map-atlas')!.children.at(-1)!.attributes.href,'/?atlas=1');
});
