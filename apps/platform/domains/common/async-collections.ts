/** Sequential predicates keep authorization checks and failures ordered on one transaction client. */
export async function filterAsync<T>(rows:readonly T[],predicate:(row:T,index:number)=>Promise<unknown>):Promise<T[]> {const out:T[]=[];for(let n=0;n<rows.length;n++)if(await predicate(rows[n]!,n))out.push(rows[n]!);return out;}
export async function someAsync<T>(rows:readonly T[],predicate:(row:T,index:number)=>Promise<unknown>):Promise<boolean> {for(let n=0;n<rows.length;n++)if(await predicate(rows[n]!,n))return true;return false;}
export async function everyAsync<T>(rows:readonly T[],predicate:(row:T,index:number)=>Promise<unknown>):Promise<boolean> {for(let n=0;n<rows.length;n++)if(!await predicate(rows[n]!,n))return false;return true;}
export async function findAsync<T>(rows:readonly T[],predicate:(row:T,index:number)=>Promise<unknown>):Promise<T|undefined> {for(let n=0;n<rows.length;n++)if(await predicate(rows[n]!,n))return rows[n];return undefined;}
export async function eachAsync<T>(rows:readonly T[],work:(row:T,index:number)=>Promise<unknown>):Promise<void> {for(let n=0;n<rows.length;n++)await work(rows[n]!,n);}
export async function mapAsync<T,R>(rows:readonly T[],project:(row:T,index:number)=>Promise<R>):Promise<R[]> {const out:R[]=[];for(let n=0;n<rows.length;n++)out.push(await project(rows[n]!,n));return out;}
