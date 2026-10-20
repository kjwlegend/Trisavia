import type { ExactFilters, JsonObject, M1ReadSession, M1Transaction, StoredRow } from '../../contracts/store.ts';
import { StorageError } from '../../contracts/store.ts';
import { fail } from './errors.ts';
export type Scalar=ExactFilters[string];
export type Page={limit:number;afterId?:string};
/** Internal repository mutation seam; read-only session and PG transaction modes both enforce this boundary. */
export function writeRows(session:M1ReadSession):M1Transaction {if(!('insert' in session)||typeof session.insert!=='function')throw new StorageError('invalid_usage','A write transaction is required');return session as M1Transaction;}
export interface RowReader {get(id:string):Promise<StoredRow|undefined>}
export interface RowWriter {replace(row:StoredRow,expectedVersion:number):Promise<boolean>}
export async function requireRow(repository:RowReader,id:string):Promise<StoredRow> {const row=await repository.get(id);if(!row)fail('target_not_accessible',404,'Target is not accessible');return row;}
export async function patchRow(repository:RowWriter,row:StoredRow,patch:JsonObject):Promise<StoredRow> {const next={...row,version:row.version+1,data:{...row.data,...patch}};if(!await repository.replace(next,row.version))fail('version_conflict',409,'State changed; read the current result');return next;}
