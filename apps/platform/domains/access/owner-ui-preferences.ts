import type {JsonObject,StoredRow} from '../../contracts/store.ts';
import {StorageError} from '../../contracts/store.ts';
import {fail} from '../common/errors.ts';

export type OwnerUiLocale='zh-CN'|'en';
export function optionalUiLocale(value:unknown):OwnerUiLocale|undefined{
 if(value===undefined)return undefined;
 if(value!=='zh-CN'&&value!=='en')fail('invalid_request',400,'Choose a supported human interface language',{field:'uiLocale'});
 return value;
}
export function ownerUiPreferencesView(owner:StoredRow,asOf:number):JsonObject{
 const {uiLocale,uiPreferencesVersion,uiPreferencesUpdatedAt}=owner.data;
 if(uiLocale===undefined&&uiPreferencesVersion===undefined&&uiPreferencesUpdatedAt===undefined)return {ownerId:owner.id,uiLocale:null,version:1,updatedAt:null,asOf};
 if((uiLocale!=='zh-CN'&&uiLocale!=='en')||!Number.isSafeInteger(uiPreferencesVersion)||Number(uiPreferencesVersion)<1||!Number.isSafeInteger(uiPreferencesUpdatedAt)||Number(uiPreferencesUpdatedAt)<0)throw new StorageError('unavailable','Stored Owner interface preference is invalid');
 return {ownerId:owner.id,uiLocale,version:uiPreferencesVersion!,updatedAt:uiPreferencesUpdatedAt!,asOf};
}
