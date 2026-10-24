import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
export interface WelcomeCredit {agentId:string;sourceGiftId:string;sourceOperationId:string|null;amount:100;currencyCode:'star_coin';grantedAt:number;accountVersionBefore:number;accountVersionAfter:number}
export interface WelcomeCreditReader {get(agentId:string):Promise<WelcomeCredit|undefined>}
/** Fixed internal issuance participant, not a general currency mint or an Agent command. */
export interface WelcomeCreditRepository extends WelcomeCreditReader {grant(input:{agentId:string;sourceGiftId:string;sourceOperationId:string|null;grantedAt:number}):Promise<WelcomeCredit>}
export const WELCOME_CREDIT_REPOSITORY=defineRuntimeRepository<WelcomeCreditReader,WelcomeCreditRepository>('wallet.welcome_credit');
