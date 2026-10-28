export const PUBLIC_HTML_LOCALES:readonly string[];
export const PUBLIC_HTML_PAGES:readonly string[];
export interface PublicHtmlScope {publicOrigin:string|null;publishedLocales:string[]}
export interface PublicHtmlOptions {publicOrigin?:string|null;publishedLocales?:string|string[]}
export function publicHtmlScope(options?:PublicHtmlOptions):PublicHtmlScope;
export function legacyPublicHtml(html:string):string;
export function publicHtmlInputs(options:{publicRoot:string;source?:(path:string)=>Promise<Uint8Array>}):Promise<unknown|null>;
export function localizedPublicHtml(html:string,options:{page:string;locale:string;inputs:unknown;scope?:PublicHtmlScope}):string;
