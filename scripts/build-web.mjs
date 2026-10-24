import {buildWeb} from './web-build/build.mjs';
try{const manifest=await buildWeb();console.info(JSON.stringify({appVersion:manifest.appVersion,pages:Object.keys(manifest.pages),assets:manifest.assets.length,bytes:manifest.assets.reduce((n,a)=>n+a.bytes,0)}));}
catch(error){console.error('web_build_failed: '+(error instanceof Error?error.message:'unknown build error'));process.exitCode=1;}
