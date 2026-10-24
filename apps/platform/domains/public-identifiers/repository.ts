import {StorageError,type M1ReadSession,type M1Transaction} from '../../contracts/store.ts';
import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
export type PublicIdentifierKind='agent'|'owner'|'npc';
export interface PublicIdentifier {publicId:string;kind:PublicIdentifierKind;subjectId:string}
export interface PublicIdentifierReader {get(kind:PublicIdentifierKind,subjectId:string):Promise<PublicIdentifier|undefined>;find(publicId:string):Promise<PublicIdentifier|undefined>}
export interface PublicIdentifierRepository extends PublicIdentifierReader {ensure(kind:PublicIdentifierKind,subjectId:string):Promise<PublicIdentifier>}
export const PUBLIC_IDENTIFIER_REPOSITORY=defineRuntimeRepository<PublicIdentifierReader,PublicIdentifierRepository>('public_identifiers');
const sessions=new WeakMap<object,PublicIdentifierReader|PublicIdentifierRepository>();
/** Infrastructure/test composition only; a bound capability must share this session's transaction. */
export function bindPublicIdentifierRepository(session:object,repository:PublicIdentifierReader|PublicIdentifierRepository){sessions.set(session,repository);}
export function publicIdentifierRepository(session:M1ReadSession):PublicIdentifierReader{const r=sessions.get(session);if(!r)throw new StorageError('unavailable','Public identifiers require the prepared storage adapter');return r;}
export function parsePublicId(value:unknown):string{if(typeof value!=='string'||!/^[AHN](?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,18})$/.test(value))throw new StorageError('invalid_usage','Use the exact stable public identifier');return value;}
export async function readPublicId(session:M1ReadSession,kind:PublicIdentifierKind,subjectId:string):Promise<string>{const r=await publicIdentifierRepository(session).get(kind,subjectId);if(!r)throw new StorageError('unavailable','Public identifier has not been prepared');return r.publicId;}
export async function ensurePublicId(session:M1Transaction,kind:PublicIdentifierKind,subjectId:string):Promise<string>{const r=publicIdentifierRepository(session);if(!('ensure' in r)||typeof r.ensure!=='function')throw new StorageError('invalid_usage','A write transaction is required');return (await r.ensure(kind,subjectId)).publicId;}
/** Internal lookup only. A mapping never authorizes reading its current subject. */
export async function findPublicIdentifier(session:M1ReadSession,publicId:string):Promise<PublicIdentifier|undefined>{return publicIdentifierRepository(session).find(parsePublicId(publicId));}
