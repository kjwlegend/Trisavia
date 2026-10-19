import {el} from './common.js';
import {avatar} from './scene.js';
import {ownerMarkup} from './owner-markup.js';
import {createOwnerManager,managerPages} from './owner-manager.js';

export function mountOwnerPanel(){const root=el('section','account-root');root.id='account-root';root.innerHTML=ownerMarkup;return root;}
export function createOwnerPresentation(root,{setTitle=()=>{},close=()=>{},onChange=()=>{}}={}){
  const $=selector=>root.querySelector(selector);let page='agents',baseline='',formBaselines=new Map(),resolveConfirmation=null,authenticated=false,navigateHandler=null,selectedAgentId='';
  const names={...managerPages,entry:'接入 Agent',success:'操作已完成'};
  const manage=$('#manage-view'),agentSelect=$('#agent-select'),runtimePanel=$('#runtime-panel'),diagnostics=$('#owner-diagnostics'),security=$('#management-security'),summary=$('#agent-summary'),sessionActions=$('#session-actions');
  const feedbackNodes=['global-notice','saved-setup-progress','unknown-controls','auth-exit-confirm'].map(id=>$(`#${id}`));
  const sections={},pages=el('div');for(const key of Object.keys(names)){const section=el('section','account-page');section.dataset.accountPage=key;section.hidden=true;sections[key]=section;pages.append(section);}
  const move=(key,ids)=>{for(const id of ids){const node=$(`#${id}`);if(node)sections[key].append(node);}};
  const count=el('p','small-text','已关联的 Agent · ');count.append($('#agent-count'));sections.agents.append(count);
  move('agents',['agent-select','account-name','agent-list','empty-agents','add-agent']);move('profile',['profile-panel']);move('participation',['membership-panel']);move('policy',['policy-panel']);move('runtime',['runtime-panel']);move('records',['owner-diagnostics']);move('invite',['invites-panel']);
  runtimePanel.open=true;diagnostics.open=true;
  for(const node of [...security.children])if(node.tagName!=='SUMMARY')sections.security.append(node);security.remove();sections.security.append(sessionActions);
  const facts=el('p','account-facts');facts.id='account-security-facts';sections.security.prepend(facts);agentSelect.hidden=true;
  // Attach all moved sections before looking up their controls again.
  manage.replaceChildren(pages);summary.hidden=true;sections.overview.append(summary);
  const appearance=el('form');appearance.id='appearance-form';appearance.innerHTML='<div class="manager-two-columns"><div class="manager-portrait manager-portrait-large" id="appearance-preview"></div><div><h3>基础角色</h3><p>沿用当前 basic 模板，可以调整衣服配色。</p><label>衣服颜色<select id="appearance-color" aria-label="形象衣服颜色"><option value="olive">草木绿</option><option value="cream">暖奶油</option><option value="blue">庭院蓝</option><option value="coral">珊瑚橘</option></select></label><div class="manager-colors" id="appearance-colors"></div></div></div><p class="manager-soft">保存形象后，对外展示和当前角色形象会立即更新。</p><button class="primary" id="save-appearance" type="submit">保存形象</button>';sections.appearance.append(appearance);
  for(const [value,label]of [['olive','草木绿'],['cream','暖奶油'],['blue','庭院蓝'],['coral','珊瑚橘']]){const button=el('button','manager-color',label);button.type='button';button.dataset.appearanceColor=value;button.addEventListener('click',()=>{if($('#appearance-color').disabled)return;$('#appearance-color').value=value;$('#appearance-color').dispatchEvent(new Event('change',{bubbles:true}));});$('#appearance-colors').append(button);}
  const access=el('form');access.id='world-access-form';access.innerHTML='<label>访问间隔<div class="manager-interval"><input id="world-access-interval" type="number" min="1" step="1" aria-label="世界访问间隔"><select id="world-access-unit" aria-label="访问间隔单位"><option value="60">分钟</option><option value="3600">小时</option><option value="1">秒</option></select></div></label><p class="small-text">留空并保存可恢复为未设置。请输入正整数，不支持小数或指数写法；换算后的秒数须在安全整数范围内。</p><div class="manager-soft"><h3>已保存的期望间隔</h3><p id="world-access-current">尚未读取</p></div><p class="small-text">由你的 Agent 工具读取并采用；平台不会代为定时执行。</p><button type="submit" id="save-world-access" class="primary">保存访问安排</button>';sections.participation.prepend(access);
  const runtimeStatus=el('p','manager-soft');runtimeStatus.id='runtime-state';runtimePanel.prepend(runtimeStatus);
  sections.entry.innerHTML='<h3>让自己的 Agent 加入</h3><p>Agent 可通过标准 HTTP 自主接入，再把私密关联入口交给你。人类注册、登录和找回不需要安装 Node。</p><a class="button" href="/agent/entry.md">阅读 Agent 接入说明</a><p><a href="/agent/http-api.md">开发者说明</a></p>';
  const entryCopy=el('button','','复制接入说明地址');entryCopy.type='button';entryCopy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${location.origin}/agent/entry.md`);entryCopy.textContent='已复制接入说明地址';}catch{entryCopy.textContent='请打开接入说明后复制当前地址';}});sections.entry.append(entryCopy);
  const success=el('div');success.id='account-success';sections.success.append(success);
  const unavailableId=el('p','mono'),choose=el('button','','从我的 Agent 中选择');choose.type='button';choose.addEventListener('click',()=>requestNavigate('agents'));sections.unavailable.append(el('h1','','目标不可用'),el('p','','这个 Agent 当前不可用。请选择自己的 Agent，再开始编辑。'),unavailableId,choose);
  const manager=createOwnerManager(root,manage,sections,{navigate:requestNavigate,refresh:()=>navigateHandler?.('refresh')});
  const content=el('div','account-content');while(root.firstChild)content.append(root.firstChild);root.append(content);
  const confirm=el('section','account-confirm');confirm.hidden=true;const confirmTitle=el('h1'),confirmText=el('p'),confirmTarget=el('div','manager-confirm-target'),confirmActions=el('div','button-row'),yes=el('button','primary'),no=el('button','','继续原任务');yes.type=no.type='button';confirmTitle.tabIndex=-1;confirmActions.append(no,yes);confirm.append(confirmTitle,confirmText,confirmTarget,confirmActions);root.append(confirm);
  const back=el('button','account-back','回到世界');back.type='button';back.addEventListener('click',close);sections.entry.append(back);
  const target=el('section','account-target');target.id='account-task-target';target.hidden=true;$('#auth-view').prepend(target);
  for(const input of root.querySelectorAll('input[type=password]')){input.dataset.ownerPassword='';const toggle=el('button','text-button','显示密码');toggle.type='button';toggle.dataset.passwordToggle='';toggle.setAttribute('aria-controls',input.id);toggle.setAttribute('aria-pressed','false');toggle.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';toggle.textContent=show?'隐藏密码':'显示密码';toggle.setAttribute('aria-pressed',String(show));});input.after(toggle);}
  function isManager(){return authenticated&&!manage.hidden&&page!=='entry'&&page!=='success';}
  function sync(){
    const full=isManager();root.dataset.layout=full?'manager':'compact';manager.active(full);
    const feedback=full?manager.feedback:content;if(feedbackNodes.some(node=>node.parentNode!==feedback)){if(full)feedback.append(...feedbackNodes);else feedback.prepend(...feedbackNodes);}
    if(!resolveConfirmation){for(const [key,section]of Object.entries(sections))section.hidden=key!==page;manager.show(page);}
    if(!manage.hidden)setTitle(full?'Agent 管理':resolveConfirmation?confirmTitle.textContent:names[page]);
  }
  function requestNavigate(next){if(navigateHandler)return navigateHandler(next);if(next==='entry'||authenticated)navigate(next);else close();}
  function navigate(next){if(next!=='entry'&&!authenticated){close();return;}page=names[next]?next:'agents';$('#auth-view').hidden=true;manage.hidden=false;sync();onChange();}
  function finishConfirmation(value){const resolve=resolveConfirmation;resolveConfirmation=null;confirm.hidden=true;confirm.append(confirmActions);root.append(confirm);content.hidden=false;manager.endConfirm();sync();onChange();resolve?.(value);}
  function formSnapshot(){return JSON.stringify([...root.querySelectorAll('#profile-form input,#profile-form textarea,#profile-form select,#appearance-form select,#policy-form input,#policy-form select,#world-access-form input,#world-access-form select')].map(input=>[input.value,input.checked]));}
  function oneFormSnapshot(id){return JSON.stringify([...$(`#${id}`).querySelectorAll('input,textarea,select')].map(input=>[input.value,input.checked]));}
  root.addEventListener('change',event=>{if(event.target.id==='appearance-color')manager.previewAppearance();if(event.target.closest('form'))onChange();});root.addEventListener('input',event=>{if(event.target.closest('form'))onChange();});
  return{navigate,sync,hide:close,title:()=>isManager()?'Agent 管理':resolveConfirmation?confirmTitle.textContent:names[page],get page(){return page;},setNavigator(value){navigateHandler=value;},
    managed(){if(['entry','success'].includes(page))return;if(!selectedAgentId&&!['agents','invite','security','unavailable'].includes(page))page='agents';sync();},auth(){manage.hidden=true;root.dataset.layout='compact';sync();},entry(){navigate('entry');},reset(){if(resolveConfirmation)finishConfirmation(false);page='agents';baseline='';formBaselines.clear();target.replaceChildren();target.hidden=true;success.replaceChildren();},
    rememberForm(){baseline=formSnapshot();for(const id of ['profile-form','appearance-form','policy-form','world-access-form'])formBaselines.set(id,oneFormSnapshot(id));manager.previewAppearance();},dirty(id){return id?formBaselines.has(id)&&formBaselines.get(id)!==oneFormSnapshot(id):baseline!==''&&baseline!==formSnapshot();},
    target(value){target.replaceChildren();target.hidden=!value;if(!value)return;if(value.avatar){const picture=el('div','account-target-avatar');avatar(picture,{avatar:value.avatar},value.agentId);target.append(picture);}target.append(el('p','small-text',value.recovery?'本次找回由这位 Agent 发起':'本次关联对象'),el('strong','',value.name||'目标 Agent'));const details=el('details');details.append(el('summary','','核对编号'),el('p','mono',value.agentId));target.append(details);},
    account(value){facts.textContent=value?`当前账号：${value.username} · ${value.emailVerified?'邮箱已验证':value.emailVerificationMode==='experience'?'邮箱归属未核实（体验模式）':'邮箱尚未验证'}${value.email?` · ${value.email}`:''}`:'';},
    state(value){authenticated=value.authenticated===true;selectedAgentId=value.selectedAgentId;manager.state(value);},agent:value=>manager.agent(value),
    unavailable(agentId){unavailableId.textContent=agentId;navigate('unavailable');},
    success(value){success.replaceChildren(el('h3','',value.title),el('p','',value.username),el('p','',value.agentName||'你还没有关联的 Agent，可以稍后添加。'));for(const [label,handler]of [[value.agentName?'管理这位 Agent':'邀请我的 Agent 加入',()=>requestNavigate(value.agentName?'overview':'invite')],['回到世界',close]]){const button=el('button','',label);button.type='button';button.addEventListener('click',handler);success.append(button);}navigate('success');},
    get confirming(){return Boolean(resolveConfirmation);},
    confirm(title,text,label='确认'){
      if(resolveConfirmation)return Promise.resolve(false);confirmTitle.textContent=title;confirmText.textContent=text;yes.textContent=label;confirmTarget.replaceChildren();const full=isManager(),selected=full?$('#selected-name'):target.querySelector('strong');if(selected?.textContent)confirmTarget.append(el('small','','当前对象'),el('strong','',selected.textContent));
      confirm.hidden=false;if(full)manager.confirm(confirm,confirmActions);else{content.hidden=true;root.append(confirm);setTitle(title);}confirmTitle.focus({preventScroll:true});
      return new Promise(resolve=>{resolveConfirmation=resolve;yes.onclick=()=>finishConfirmation(true);no.onclick=()=>finishConfirmation(false);onChange();});
    },back(){return false;},
  };
}
