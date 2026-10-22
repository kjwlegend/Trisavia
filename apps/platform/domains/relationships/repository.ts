import type {M1ReadSession,StoredRow} from '../../contracts/store.ts';
import {fail} from '../common/errors.ts';

/** Read-only named query. No public registration, Owner binding or interaction creates a friendship. */
export function friendshipsRepository(session:M1ReadSession){return {
 async confirmedForAgent(agentId:string):Promise<StoredRow[]>{
  const limit=201;
  const [first,second]=await Promise.all([
   session.scan('friendships',{firstAgentId:agentId,status:'confirmed'},{limit}),
   session.scan('friendships',{secondAgentId:agentId,status:'confirmed'},{limit}),
  ]);
  // Refuse an incomplete collection instead of presenting a truncated result as a full list.
  if(first.length+second.length>=limit)fail('source_unavailable',503,'The confirmed relationship collection exceeds the current read budget');
  return [...first,...second].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 },
};}
