import {PROFILE_PERSONALIZATION_GUIDE} from './agent-profile-guide.ts';
import {CURRENT_RECURRING_HOST_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,CURRENT_HOURLY_HUMAN_GUIDE,FROZEN_HOURLY_HUMAN_GUIDE} from './agent-hourly-participation-guide.ts';
import {AGENT_HUMAN_VOICE_GUIDE,AGENT_AUTONOMY_GUIDE} from './agent-human-voice.ts';
import {APPROVED_PROFILE_RULES,APPROVED_RUNTIME_HOST_GUIDE,APPROVED_HUMAN_COMMUNICATION} from './agent-approved-prompts.ts';

// This exact whole-block variant was published by the existing
// publishNewResidentGuideInTransaction brand correction. It is never a broad
// replacement against an incoming guide, nor a change to a frozen export.
const publishedResidentHuman=CURRENT_HOURLY_HUMAN_GUIDE.replaceAll('Trisavia（新城）','Trisavia');
// Preserve the actually published first private handoff, not the two old
// examples about an unspoken encounter and routinely asking where to go.
const privateHandoff=publishedResidentHuman.split('\n首次交接')[1]!.split('\n已绑定：')[0]!;
const currentHuman=APPROVED_HUMAN_COMMUNICATION+'\n首次交接'+privateHandoff;
function replacement(id:string,before:string,after:string,beforeVariants:readonly string[]=[before],allowAlreadyCorrect=false){
 return Object.freeze({id,before,after,beforeVariants:Object.freeze([...beforeVariants]),allowAlreadyCorrect});
}
export const APPROVED_TEMPLATE_REPLACEMENTS=Object.freeze([
 replacement('profile-v1',PROFILE_PERSONALIZATION_GUIDE,APPROVED_PROFILE_RULES),
 replacement('recurring-bootstrap-v1',CURRENT_RECURRING_HOST_GUIDE,APPROVED_RUNTIME_HOST_GUIDE),
 replacement('human-voice-v1',AGENT_HUMAN_VOICE_GUIDE,currentHuman,[AGENT_HUMAN_VOICE_GUIDE,FROZEN_HOURLY_HUMAN_GUIDE,CURRENT_HOURLY_HUMAN_GUIDE,publishedResidentHuman]),
 // The prior hourly correction may already be present. Neither path creates
 // a schedule or permits mixed old/current or duplicate blocks.
 replacement('legacy-hourly-default',AGENT_AUTONOMY_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE,[AGENT_AUTONOMY_GUIDE],true),
]);
/** Only one complete known predecessor (or explicitly allowed current block) is valid. */
export function rewriteApprovedAgentTemplateText(source:string):string {
 let text=source;
 for(const row of APPROVED_TEMPLATE_REPLACEMENTS){
  const candidates=row.beforeVariants.map(before=>({before,count:text.split(before).length-1})),oldCount=candidates.reduce((sum,row)=>sum+row.count,0),currentCount=text.split(row.after).length-1;
  if(oldCount===1&&currentCount===0)text=text.replace(candidates.find(candidate=>candidate.count===1)!.before,row.after);
  else if(!(row.allowAlreadyCorrect&&oldCount===0&&currentCount===1))throw new Error('Exact approved-template predecessor required: '+row.id);
 }
 return text;
}
