import {hashRuntimeRequest} from '../runtime/command.ts';
import type {JsonObject} from '../../contracts/store.ts';
/** Exact WS02 db379a99 versioned body, copied into the runtime package; documentation paths are never runtime dependencies. */
export const LIFE_C_BOOKS=[
 {
  "bookId": "qingzhou_life_guide",
  "version": 1,
  "authorDisplay": "蓝檐书屋",
  "title": "清昼小镇生活指南",
  "locale": "zh-CN",
  "readingScope": "C切片阅读能力正式接通后，作为蓝檐书屋的公开免费馆藏提供正文；阅读活动限书屋阅读区，执行条件与结果权限沿WS03原合同。",
  "body": "刚来清昼小镇，可以先认一认市政厅、港湾酒馆、石岸旅舍和蓝檐书屋。它们各有各的用处，不必一天就走遍。新居民的迎新服务在市政厅；已经领过的欢迎礼，也会留在自己的领取记录里。\n\n想找一份工作，可以去盐风仓棚看看码头岗位，或到港湾酒馆看看帮工岗位。先看清岗位的条件和空位，再决定接哪一班。忙完以后，花径凉亭有免费的长椅；休息需要留出一段时间，走到旁边并不等于已经歇好了。\n\n蓝檐书屋的阅读位在外廊。这里有免费馆藏，也出售可以自己保管的手册。你可以选一本书，找一个空位坐下；一次阅读结束后，书中哪些事情值得再试，要由你自己决定。\n\n想吃点东西，可以看看酒馆的餐食；想换个地方休憩，可以看看旅舍的说明。酒馆、凉亭的餐位与旅舍的休憩廊各有用途，门前的路仍要留给来往的邻居。\n\n清昼小镇在初晓洲。地图册上还有日落海、逐鹿原和北方山地，那些地方目前尚未开放。今天能走的路就在镇里：认得一处新地方，完成一件小事，便能为下一次出门多留一点熟悉。"
 },
 {
  "bookId": "harbor_handbook",
  "version": 1,
  "authorDisplay": "蓝檐书屋",
  "title": "港湾生活手册",
  "locale": "zh-CN",
  "readingScope": "C切片阅读能力正式接通后，作为自有物品harbor_handbook对应的版本化正文；取得正文须按原书籍与持有权限校验，阅读活动限蓝檐书屋阅读区，不新增Owner或runtime权限。",
  "body": "港湾里的一天，可以从不同的地方开始。盐风仓棚旁有码头短工，港湾酒馆也需要帮手；想安静一会儿，则可以带上鱼具，到近岸或外侧栈桥看看。先选今天想做的事，再去看相应的岗位或活动点是否有空位。\n\n渔人小铺供应鱼竿和鱼饵，也收购符合条件的鱼。出门前看看自己的背包，缺什么再买什么。钓位设在陆地或栈桥上，旁边的通路留给经过的人。开始垂钓后，一竿可能有鱼，也可能没有；背包里实际得到的东西，才是这趟垂钓的收获。\n\n有了鱼，可以带回小铺查看收购说明，也可以去酒馆看看鱼餐加工。加工前认清自己选的是哪一条：做成鱼餐后，它就不再是一条可以出售的生鱼。鱼获不必一有就卖，怎样安排由持有它的居民决定。\n\n酒馆买来的餐食先放进背包。想吃的时候，再去酒馆或凉亭的用餐位，选定自己的食物。买到一份饭与吃完一份饭，是两件事；如果暂时不想花钱，花径凉亭的免费休息也是一个选择。\n\n不管今天去上工、钓鱼还是吃饭，结束后都可以看看实际结果。事情中途停下，就先认清已经完成了什么、还剩下什么。港湾的日子不必排得满满当当，给下一次出门留一条路，也很好。"
 }
] as const;
export function lifeBook(id:string){const book=LIFE_C_BOOKS.find(b=>b.bookId===id);return book?{...book,digest:hashRuntimeRequest(book as unknown as JsonObject)}:undefined;}
