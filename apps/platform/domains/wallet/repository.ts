import type { JsonObject, M1ReadSession, M1Transaction, StoredRow } from '../../contracts/store.ts';
export interface WalletAccount extends JsonObject {agentId:string;currencyCode:'star_coin';currencyName:string;scale:0;balance:number;initializedAt:number;initializationSource:'migration'|'registration'}
export const walletAccountId=(agentId:string)=>`star_coin:${agentId}`;
/** Wallet owns its source rows; perception only publishes the read contract. */
export function walletRepository(session:M1ReadSession){return {get:(agentId:string):StoredRow<WalletAccount>|undefined=>session.get<WalletAccount>('wallet_accounts',walletAccountId(agentId))};}
/** Registration invokes this in its existing atomic command transaction. Never called by a query. */
export function initializeWalletAccount(tx:M1Transaction,agentId:string,stamp:number):void {
 if(!tx.get('agents',agentId))throw new Error('Wallet requires an existing Agent');
 const id=walletAccountId(agentId);if(!tx.get('wallet_accounts',id))tx.insert('wallet_accounts',{id,version:1,data:{agentId,currencyCode:'star_coin',currencyName:'星币',scale:0,balance:0,initializedAt:stamp,initializationSource:'registration'}});
}
