export const BEHAVIOR_HUMAN_SCHEMA:'behavior-human-read';
export const BEHAVIOR_HUMAN_VERSION:1;
export type BehaviorPresentationField='title'|'action'|'result'|'summary';
export type BehaviorTemplateParam={readonly kind:'text';readonly maxLength:number}|{readonly kind:'integer';readonly minimum:number}|{readonly kind:'items';readonly roles:readonly string[];readonly minItems:number;readonly maxItems:number};
export interface BehaviorTemplateDefinition {readonly templateId:string;readonly templateVersion:1;readonly field:BehaviorPresentationField;readonly dictionaryKey:string;readonly params:Readonly<Record<string,BehaviorTemplateParam>>}
export const BEHAVIOR_TEMPLATE_CATALOG:Readonly<Record<string,BehaviorTemplateDefinition>>;
export interface BehaviorTemplateLeaf {kind:'template';templateId:string;templateVersion:number;paramsSnapshot:Record<string,unknown>}
export function templateDictionaryKey(id:string,version:number):string|null;
export function validateBehaviorTemplateLeaf(value:unknown):{known:false}|{known:true;definition:BehaviorTemplateDefinition};
export function formatBehaviorTemplateParams(leaf:BehaviorTemplateLeaf,locale:string):Record<string,string|number|boolean>;
