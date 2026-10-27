// Synthetic source presentation only. No login, server, or real Agent task.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
// @ts-expect-error Browser module.
import {extractRuntimeUpdatePrompt} from '../../apps/web/public/onboarding-prompt.js';

test('overview reaches the visible unique update prompt, preserving forms and using each current origin',async t=>{
  const root=resolve('apps/web/public'),out=resolve('outputs/runtime-update-entry-v072');
  const template=await readFile('docs/access/v1/prompt.md','utf8');
  const styles=(await readFile(resolve(root,'index.html'),'utf8')).match(/<link rel="stylesheet"[^>]+>/g)!.join('');
  const browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  t.after(()=>browser.close());await mkdir(out,{recursive:true});const results=[];
  for(const [origin,width]of [['http://127.0.0.1:18772',1440],['https://trisavia.kjwlabs.com',811]] as const){
    const reads:any[]=[],unexpected:string[]=[],errors:string[]=[];
    const context=await browser.newContext({viewport:{width,height:854}});
    try{
      await context.addCookies([{name:'fixture-cookie',value:'private-not-for-prompt',url:origin}]);
      await context.addInitScript(()=>{(window as any).copies=[];(window as any).publicOptions=[];const original=fetch;window.fetch=(input,options)=>{if(input==='/agent/prompt.md')(window as any).publicOptions.push(options);return original(input,options);};Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>(window as any).copies.push(text)}});});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin||request.method()!=='GET'){unexpected.push(request.method()+' '+url.href);await route.abort();return;}
        if(url.pathname==='/agent/prompt.md'){reads.push({url:url.href,method:request.method(),cookie:request.headers().cookie??null,authorization:request.headers().authorization??null});await route.fulfill({contentType:'text/markdown; charset=utf-8',body:template});return;}
        if(url.pathname==='/'){
          await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:12px!important;overflow:auto!important}#personal{position:relative;z-index:100}.hud-root{position:static!important;pointer-events:auto!important}.hud-root .hud-window{position:relative!important;inset:auto!important;transform:none!important;translate:none!important;width:1000px!important;max-width:calc(100vw - 24px)!important;height:730px!important;max-height:none!important}</style></head><body class="world-home paper-hud"><button id="personal">个人</button><div class="hud-root"><section class="hud-window is-account is-manager"><div class="hud-window-body" id="host"></div></section></div><script type="module">
            import{mountOwnerPanel,createOwnerPresentation}from'/assets/owner-panel.js';
            const root=mountOwnerPanel();document.querySelector('#host').append(root);const presentation=createOwnerPresentation(root),appearance={lookId:'sunnyside-human-shorthair',catalogVersion:'2026-10-21.appearance-v1.1'},agent={agentId:'synthetic-agent-private',publicId:'A901',profile:{version:1,policyVersion:1,mode:'agent_autonomous',lockedFields:[],proposalPending:false,published:{displayName:'合成居民',bio:'',interests:[],avatar:appearance},publishedAppearance:appearance,draft:null},membership:{state:'joined',version:1,worldId:'default',ownerPaused:false,platformRestricted:false},worldAccess:{intervalSeconds:3600},runtimeActive:true};
            presentation.state({authenticated:true,phase:'ready',observationRevision:1,selectedAgentId:agent.agentId,username:'synthetic-owner-private',agents:[{agentId:agent.agentId,name:'合成居民',avatar:appearance,publicId:'A901',membership:'joined'}]});presentation.agent(agent);window.navigations=[];window.allowNavigation=true;presentation.setNavigator(async next=>{window.navigations.push(next);await Promise.resolve();if(window.allowNavigation)presentation.navigate(next);});document.querySelector('#personal').onclick=()=>presentation.navigate('overview');presentation.navigate('agents');
          </script></body></html>`});return;
        }
        if(!url.pathname.startsWith('/assets/')){unexpected.push(request.method()+' '+url.pathname);await route.abort();return;}
        const path=resolve(root,decodeURIComponent(url.pathname.slice(8)));if(!path.startsWith(root+'/')){unexpected.push(url.pathname);await route.abort();return;}
        try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:''});}
      });
      const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
      await page.getByRole('button',{name:'个人',exact:true}).click();
      const overview=page.locator('[data-account-page=overview]'),entry=overview.getByRole('button',{name:'更新 Agent 参与规则',exact:true}),prompt=page.locator('#participation-runtime-update');
      await expect(entry).toBeVisible();assert.ok(await entry.evaluate(node=>{const box=node.getBoundingClientRect(),scroll=document.querySelector('#manager-scroll')!.getBoundingClientRect();return box.top>=scroll.top&&box.bottom<=scroll.bottom;}));
      // A guarded navigation rejection must not jump/focus a hidden prompt.
      await page.evaluate(()=>(window as any).allowNavigation=false);await entry.click();await expect(overview).toBeVisible();await expect(prompt).toBeHidden();
      await page.evaluate(()=>(window as any).allowNavigation=true);await entry.click();await expect(prompt).toBeVisible();await expect(prompt.locator('h3')).toBeFocused();
      const geometry=await prompt.evaluate(node=>{const box=node.getBoundingClientRect(),scroll=document.querySelector('#manager-scroll')!.getBoundingClientRect(),page=node.parentElement!;return{top:box.top,bottom:box.bottom,scrollTop:scroll.top,scrollBottom:scroll.bottom,firstContent:page.children[1]===node};});
      assert.ok(geometry.firstContent);assert.ok(geometry.top>=geometry.scrollTop&&geometry.bottom<=geometry.scrollBottom);
      await prompt.getByRole('button',{name:'复制更新提示',exact:true}).click();await expect(prompt.locator('[role=status]')).toHaveText('提示词已复制，请交给你自己的 Agent。');
      await prompt.locator('summary').click();const expected=extractRuntimeUpdatePrompt(template,origin);await expect(prompt.locator('pre')).toHaveText(expected);
      await page.getByLabel('世界访问间隔',{exact:true}).fill('7');
      await page.getByRole('navigation',{name:'Agent 管理页面'}).getByRole('button',{name:'角色概览',exact:true}).click();await entry.click();await expect(prompt.locator('h3')).toBeFocused();await expect(page.getByLabel('世界访问间隔',{exact:true})).toHaveValue('7');
      await page.getByRole('navigation',{name:'Agent 管理页面'}).getByRole('button',{name:'角色概览',exact:true}).click();await page.getByRole('navigation',{name:'Agent 管理页面'}).getByRole('button',{name:'世界访问',exact:true}).click();
      await expect(prompt).toBeVisible();assert.ok(await prompt.evaluate(node=>node.getBoundingClientRect().top<document.querySelector('#manager-scroll')!.getBoundingClientRect().bottom));
      const copies=await page.evaluate(()=>(window as any).copies),options=await page.evaluate(()=>(window as any).publicOptions);
      assert.deepEqual(copies,[expected]);assert.equal(reads.length,1);assert.ok(reads.every(r=>!r.cookie&&!r.authorization));assert.ok(options.every((o:any)=>o.credentials==='omit'&&o.cache==='no-store'&&o.redirect==='error'));assert.doesNotMatch(expected,/synthetic-agent|synthetic-owner|sessionToken|runtimeToken/);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
      results.push({origin,width,geometry,reads,copies,navigations:await page.evaluate(()=>(window as any).navigations)});await page.screenshot({path:resolve(out,width+'-participation.png')});await page.close();
    }finally{await context.close();}
  }
  await writeFile(resolve(out,'source-results.json'),JSON.stringify({scope:'Synthetic source UI with the fixed public template; no real account/task/service',results},null,2)+'\n');
});
