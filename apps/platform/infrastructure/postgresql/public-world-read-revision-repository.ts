import {PUBLIC_WORLD_READ_REVISION} from '../../domains/world/public-read-revision.ts';
import {StorageError} from '../../contracts/store.ts';
import type {RuntimeSql} from './runtime-sql.ts';

/** Read on the existing guarded transaction. A row/world revision alone cannot invalidate private visibility changes. */
export function createPublicWorldReadRevisionRepository(sql:RuntimeSql){
 const reader={async read(){const row=(await sql.query('SELECT instance_id,recovery_epoch,write_generation::text AS generation,writes_enabled FROM platform.instance_state WHERE singleton=1'))[0];
  if(!row||typeof row.generation!=='string'||!/^\d{1,19}$/.test(row.generation)||typeof row.writes_enabled!=='boolean')throw new StorageError('conflict','Public world revision is unavailable');
  return{instanceId:String(row.instance_id),recoveryEpoch:String(row.recovery_epoch),writeGeneration:row.generation,writeGate:row.writes_enabled};
 }};return{port:PUBLIC_WORLD_READ_REVISION,reader,writer:reader};
}
