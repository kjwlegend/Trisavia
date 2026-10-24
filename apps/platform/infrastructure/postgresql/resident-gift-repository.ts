import {RESIDENT_GIFT_REPOSITORY,type ResidentGift,type ResidentGiftReader,type ResidentGiftRepository} from '../../domains/town-services/resident-gift.ts';
import {number,type RuntimeSql} from './runtime-sql.ts';
const value=(r:Record<string,any>):ResidentGift=>({id:r.id,agentId:r.agent_id,createdAt:number(r.created_at),sourceOperationId:r.source_operation_id,initiatorKind:r.initiator_kind,initiatorId:r.initiator_id});
export function createResidentGiftRepository(sql:RuntimeSql){const repo:ResidentGiftRepository={
 async get(id){const r=(await sql.query('SELECT * FROM town_services.resident_gifts WHERE agent_id=$1',[id]))[0];return r?value(r):undefined;},
 async byId(id){const r=(await sql.query('SELECT * FROM town_services.resident_gifts WHERE id=$1',[id]))[0];return r?value(r):undefined;},
 async ensure(v){sql.writable();const old=await repo.get(v.agentId);if(old)return old;await sql.mutate('INSERT INTO town_services.resident_gifts(id,agent_id,created_at,source_operation_id,initiator_kind,initiator_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agent_id) DO NOTHING',[v.id,v.agentId,v.createdAt,v.sourceOperationId,v.initiatorKind,v.initiatorId]);return (await repo.get(v.agentId))!;}
 };return {port:RESIDENT_GIFT_REPOSITORY,reader:{get:repo.get,byId:repo.byId} as ResidentGiftReader,writer:repo};}
