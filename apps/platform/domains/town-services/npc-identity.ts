import source from './npc-identities-v1.json' with {type:'json'};
/** Current authored persona overlay, not historical activity or a grant of a new service. */
export interface NpcIdentity {version:1;ref:string;name:string;role:string;story:string;digest:string}
export function currentNpcIdentity(npcId:string):NpcIdentity|undefined {const p=source.profiles.find(p=>p.npcId===npcId);return p?{version:1,ref:p.ref,name:p.name,role:p.role,story:p.story,digest:p.digest}:undefined;}
export function withCurrentNpcIdentity<T extends{npcId:string;name:string;role:string}>(row:T):T&{identity?:NpcIdentity}{const identity=currentNpcIdentity(row.npcId);return identity?{...row,name:identity.name,role:identity.role,identity}:row;}
