import type {PoolClient} from 'pg';
import {StorageError} from '../../contracts/store.ts';
import {PUBLIC_IDENTIFIER_REPOSITORY,type PublicIdentifier,type PublicIdentifierKind,type PublicIdentifierRepository} from '../../domains/public-identifiers/repository.ts';
import {storageError} from './errors.ts';
const view=(r:Record<string,any>):PublicIdentifier=>({publicId:r.public_id,kind:r.subject_kind,subjectId:r.subject_id});
export function createPublicIdentifierRepository(client:PoolClient,write:boolean,alive:()=>boolean){
 const query=async(sql:string,params:unknown[])=>{if(!alive())throw new StorageError('closed','Public identifier scope ended');try{return(await client.query(sql,params)).rows;}catch(e){throw storageError(e);}};
 const repo:PublicIdentifierRepository={async get(kind,id){const r=(await query('SELECT public_id,subject_kind,subject_id FROM public_identifiers.identities WHERE subject_kind=$1 AND subject_id=$2',[kind,id]))[0];return r?view(r):undefined;},async find(id){const r=(await query('SELECT public_id,subject_kind,subject_id FROM public_identifiers.identities WHERE public_id=$1',[id]))[0];return r?view(r):undefined;},async ensure(kind,id){if(!write)throw new StorageError('invalid_usage','Public identifier allocation requires a write transaction');await query('SELECT public_identifiers.allocate($1,$2)',[kind,id]);return (await repo.get(kind,id))!;}};
 return {port:PUBLIC_IDENTIFIER_REPOSITORY,reader:{get:repo.get,find:repo.find},writer:repo};
}
