export const INTRO_PACKAGE_ROOT:string;
export const INTRO_PUBLISH_FILES:readonly string[];
export const INTRO_SOURCE_FILES:readonly string[];
export const INTRO_ROUTES:readonly {url:string;file:string}[];
export function introContentType(file:string):string|undefined;
export function copyPublishedIntro(options:{root:string;destination:string;source:(path:string)=>Promise<Uint8Array>}):Promise<{version:1;files:{file:string;sha256:string;bytes:number;contentType:string|undefined}[]}|undefined>;
