import {createPaperMailbox} from './paper-mailbox.js';

// The real Owner mailbox replaces the former example/content switcher.
export function createMailFeature(_provider,_onEnterDemo=()=>{},options={}){
 return createPaperMailbox(options);
}
