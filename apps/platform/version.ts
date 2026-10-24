import {readFileSync} from 'node:fs';

/** package.json is the single maintained application-version source. */
const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version?:unknown};
if(typeof manifest.version!=='string'||!manifest.version)throw new Error('The application package version is missing');
export const APP_VERSION=manifest.version;
