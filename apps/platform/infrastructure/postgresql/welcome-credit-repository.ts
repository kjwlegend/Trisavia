import {WELCOME_CREDIT_REPOSITORY,type WelcomeCreditReader,type WelcomeCreditRepository,type WelcomeCredit} from '../../domains/wallet/welcome-credit.ts';
import {walletRepository} from '../../domains/wallet/repository.ts';
import {createPostgresSession} from './postgres-store.ts';
import {integer,number,text,type RuntimeSql} from './runtime-sql.ts';
import {RuntimeError} from '../../contracts/runtime-store.ts';
import {fail} from '../../domains/common/errors.ts';
const credit=(r:Record<string,any>):WelcomeCredit=>({agentId:r.agent_id,sourceGiftId:r.source_gift_id,sourceOperationId:r.source_operation_id,amount:100,currencyCode:'star_coin',grantedAt:number(r.granted_at),accountVersionBefore:number(r.account_version_before),accountVersionAfter:number(r.account_version_after)});
export function createWelcomeCreditRepository(sql:RuntimeSql):{port:typeof WELCOME_CREDIT_REPOSITORY;reader:WelcomeCreditReader;writer:WelcomeCreditRepository}{
 const repo:WelcomeCreditRepository={
  async get(id){const row=(await sql.query('SELECT * FROM wallet.welcome_credits WHERE agent_id=$1',[text(id)]))[0];return row?credit(row):undefined;},
  async grant(input){sql.writable();const old=await repo.get(input.agentId);if(old){if(old.sourceGiftId!==input.sourceGiftId)throw new RuntimeError('command_conflict','The fixed welcome credit already has another source');return old;}
   const session=createPostgresSession(sql.scope.client,true,sql.scope.alive),account=await walletRepository(session).get(input.agentId);if(!account)fail('wallet_not_initialized',409,'The real registered wallet is unavailable');
   const balance=account.data.balance+100;if(!Number.isSafeInteger(balance))fail('wallet_capacity',409,'The wallet cannot receive this fixed reward');const next={...account,version:account.version+1,data:{...account.data,balance}};
   await sql.mutate('INSERT INTO wallet.welcome_credits(agent_id,source_gift_id,source_operation_id,amount,granted_at,account_version_before,account_version_after) VALUES($1,$2,$3,100,$4,$5,$6)',[text(input.agentId),text(input.sourceGiftId),input.sourceOperationId,integer(input.grantedAt),account.version,next.version]);
   if(!await session.update('wallet_accounts',next,account.version))throw new RuntimeError('version_conflict','The wallet changed');return (await repo.get(input.agentId))!;
  },
 };return {port:WELCOME_CREDIT_REPOSITORY,reader:{get:repo.get},writer:repo};
}
