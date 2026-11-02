import type {GatewayGuide} from './agent-gateway.ts';
import {CURRENT_PARTICIPATION_HOST_GUIDE,CURRENT_PARTICIPATION_JOB_BOOTSTRAP,FROZEN_PARTICIPATION_HOST_GUIDE_V0130,FROZEN_PARTICIPATION_JOB_BOOTSTRAP_V0130} from './agent-participation-guide.ts';

/** Advance only documents containing the changed bootstrap, retaining the original object. */
export function expressionGuidanceGuide(previous:GatewayGuide):GatewayGuide {
 if(previous.moduleId!=='world'&&previous.moduleId!=='life')return previous;
 const world=previous.moduleId==='world',field=world?'hostParticipation':'recurringBootstrap';
 if(previous.document[field]!==(world?FROZEN_PARTICIPATION_HOST_GUIDE_V0130:FROZEN_PARTICIPATION_JOB_BOOTSTRAP_V0130))throw new Error('Expression guidance predecessor changed');
 const version=previous.version+1;
 return {moduleId:previous.moduleId,version,document:{...structuredClone(previous.document),version,[field]:world?CURRENT_PARTICIPATION_HOST_GUIDE:CURRENT_PARTICIPATION_JOB_BOOTSTRAP}};
}
