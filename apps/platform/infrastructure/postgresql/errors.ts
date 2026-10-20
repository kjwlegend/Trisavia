import { StorageError } from '../../contracts/store.ts';
import type { OpenPostgresStoreOptions } from './transaction-host.ts';

export function state(error:unknown):string|undefined{
  if(!error||typeof error!=='object')return undefined;
  if('code'in error&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code))return error.code;
  return 'cause'in error?state(error.cause):undefined;
}
export function storageError(error:unknown):unknown{
  if(error instanceof StorageError)return error;
  const code=state(error);if(code?.startsWith('23'))return new StorageError('constraint','A database relationship or uniqueness constraint rejected this operation',{cause:error});
  if(code==='40001'||code==='40P01'||code==='55P03'||code==='57014')return new StorageError('busy','Database operation could not finish within its bounded concurrency window',{cause:error});
  if(code?.startsWith('08')||code==='57P01'||code==='57P02'||code==='57P03')return new StorageError('unavailable','Database connection is unavailable',{cause:error});
  if(error instanceof Error&&('code'in error&&['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','ENOTFOUND'].includes(String(error.code))||/connection.*(terminated|closed)|timeout exceeded|query read timeout/i.test(error.message)))return new StorageError('unavailable','Database connection is unavailable',{cause:error});
  return error;
}
export function identity(options:OpenPostgresStoreOptions){if(!options.connectionString||!options.instanceId||!options.recoveryEpoch)throw new StorageError('invalid_usage','Explicit database connection and instance identity are required');}
export function bounded(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new StorageError('invalid_usage','Invalid bounded storage option');return value;}
