import { DatabaseSync } from 'node:sqlite';
import type { M1Store,M1Table } from '../../apps/platform/contracts/store.ts';
import { migrateDatabase,migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
/** Build a declared synthetic offline SQLite baseline from logical DTOs; PG runtime never opens it. */
export async function legacyCopy(store:M1Store,path:string,version:number,tables:readonly M1Table[]){
 const rows=await store.read(async tx=>{const all=new Map<M1Table,{id:string;version:number;data:string}[]>();for(const table of tables)all.set(table,(await tx.find(table)).map(row=>({id:row.id,version:row.version,data:JSON.stringify(row.data)})));return all;});
 const db=new DatabaseSync(path);try{migrateDatabase(db,migrations.slice(0,version));db.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');db.prepare('INSERT INTO instance_state VALUES(1,?,?)').run(store.instanceId,store.recoveryEpoch);for(const [table,records]of rows){const insert=db.prepare(`INSERT INTO ${table}(id,version,data) VALUES(?,?,?)`);for(const row of records)insert.run(row.id,row.version,row.data);}db.exec('COMMIT');}finally{db.close();}return rows;
}
