import {defineRuntimeRepository,type RuntimeStore} from '../../contracts/runtime-store.ts';

export interface PublicWorldReadCut {instanceId:string;recoveryEpoch:string;writeGeneration:string;writeGate:boolean}
export const PUBLIC_WORLD_READ_REVISION=defineRuntimeRepository<{read():Promise<PublicWorldReadCut>}>('world.public_read_revision');
export interface PublicWorldPoolLimits {poolMax:number;publicConcurrency:number}
const pools=new WeakMap<RuntimeStore,Readonly<PublicWorldPoolLimits>>();
/** Trusted composition metadata, never supplied by HTTP or inferred from a viewer identifier. */
export function registerPublicWorldReadPool(store:RuntimeStore,poolMax:number):void{
 if(!Number.isSafeInteger(poolMax)||poolMax<1||poolMax>16)throw new TypeError('Invalid actual runtime pool capacity');
 pools.set(store,Object.freeze({poolMax,publicConcurrency:Math.min(2,poolMax-1)}));
}
export function publicWorldReadPool(store:RuntimeStore){return pools.get(store);}
