import {PROFILE_PERSONALIZATION_GUIDE} from './agent-profile-guide.ts';
import {CURRENT_RECURRING_HOST_GUIDE,CURRENT_HOURLY_AUTONOMY_GUIDE} from './agent-hourly-participation-guide.ts';
import {AGENT_HUMAN_VOICE_GUIDE,AGENT_AUTONOMY_GUIDE} from './agent-human-voice.ts';
import {APPROVED_PROFILE_RULES,APPROVED_RUNTIME_HOST_GUIDE,APPROVED_HUMAN_COMMUNICATION} from './agent-approved-prompts.ts';

// Keep the actual first private handoff instructions, not the two conflicting
// old examples about an unspoken encounter and routinely asking where to go.
const privateHandoff=AGENT_HUMAN_VOICE_GUIDE.split('\n首次交接')[1]!.split('\n已绑定：')[0]!;
const currentHuman=APPROVED_HUMAN_COMMUNICATION+'\n首次交接'+privateHandoff;
export const APPROVED_TEMPLATE_REPLACEMENTS=Object.freeze([
 {id:'profile-v1',before:PROFILE_PERSONALIZATION_GUIDE,after:APPROVED_PROFILE_RULES},
 {id:'recurring-bootstrap-v1',before:CURRENT_RECURRING_HOST_GUIDE,after:APPROVED_RUNTIME_HOST_GUIDE},
 {id:'human-voice-v1',before:AGENT_HUMAN_VOICE_GUIDE,after:currentHuman},
 // This is the exact prior hourly correction, not a new schedule default.
 {id:'legacy-hourly-default',before:AGENT_AUTONOMY_GUIDE,after:CURRENT_HOURLY_AUTONOMY_GUIDE},
]);
/** Text-only versioned copy. A missing/duplicate predecessor aborts publication. */
export function rewriteApprovedAgentTemplateText(source:string):string {
 let text=source;
 for(const replacement of APPROVED_TEMPLATE_REPLACEMENTS){
  if(text.split(replacement.before).length!==2)throw new Error('Exact approved-template predecessor required: '+replacement.id);
  text=text.replace(replacement.before,replacement.after);
 }
 return text;
}
