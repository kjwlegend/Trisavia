import {el} from './common.js';
import {avatar} from './scene.js';
import {icon} from './hud/icons.js';
import {ownerIdentityFacts,identityDate} from './owner-identity.js';

export const managerPages={agents:'我的 Agent',overview:'角色概览',profile:'资料编辑',appearance:'形象工作室',logs:'个人日志',participation:'世界访问',policy:'权限控制',runtime:'运行连接',records:'管理记录',invite:'邀请与关联',security:'账户与安全','public-preview':'对外资料预览',unavailable:'目标不可用'};

// This component only presents the controller's authenticated reads. It never
// owns credentials, chooses a target optimistically, or creates business data.
export function createOwnerManager(root,manage,sections,{navigate=()=>{},refresh=()=>{},appearancePicker,profileStage,isDirty=()=>false}={}){
  const $=selector=>root.querySelector(selector),summary=root.querySelector('#agent-summary'),sidebar=el('nav','manager-sidebar');sidebar.setAttribute('aria-label','Agent 管理页面');
  const switcher=el('button','manager-switch'),switchPicture=el('div','manager-switch-picture'),switchCopy=el('span');switcher.id='manager-agent-switch';switcher.type='button';switcher.setAttribute('aria-label','选择当前 Agent');switchCopy.append(el('small','','当前管理'));const switchName=el('strong');switchCopy.append(switchName);switcher.append(switchPicture,switchCopy,icon('chevron'));switcher.addEventListener('click',()=>navigate('agents'));sidebar.append(switcher);
  const navButtons=new Map(),groups=[['',[['agents','profile']]],['角色',[['overview','profile'],['profile','document'],['appearance','appearance'],['logs','clock'],['participation','world']]],['管理',[['policy','shield'],['runtime','key'],['records','clock']]],['账号',[['invite','plus'],['security','settings']]]];
  for(const [caption,items]of groups){const group=el('div','manager-nav-group');if(caption)group.append(el('span','manager-nav-caption',caption));for(const [key,symbol]of items){const button=el('button','manager-nav-button');button.type='button';button.dataset.managerPage=key;button.append(icon(symbol),el('span','',managerPages[key]));button.addEventListener('click',()=>navigate(key));navButtons.set(key,button);group.append(button);}sidebar.append(group);}
  const main=el('div','manager-main'),roleTabs=el('nav','panel-tabs role-tabs'),strip=el('div','manager-object');strip.id='manager-object';const stripName=el('strong'),stripLabel=el('span','','当前对象');const stripPicture=el('span','manager-object-picture'),manageButton=el('button','','管理'),chooseButton=el('button','','切换 Agent');manageButton.type=chooseButton.type='button';manageButton.addEventListener('click',()=>navigate('overview'));chooseButton.addEventListener('click',()=>navigate('agents'));strip.append(stripPicture,stripName,stripLabel,manageButton,chooseButton);
  roleTabs.setAttribute('aria-label','角色设置');for(const [key,label]of [['appearance','角色选择'],['profile','公开资料']]){const tab=el('button','',label);tab.type='button';tab.dataset.characterTab=key;tab.addEventListener('click',()=>navigate(key));roleTabs.append(tab);}roleTabs.hidden=true;
  const scroll=el('div','manager-scroll');scroll.id='manager-scroll';scroll.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
  const feedback=el('div','manager-feedback');feedback.id='manager-feedback';const pages=el('div','manager-pages');pages.id='manager-pages';for(const section of Object.values(sections))pages.append(section);scroll.append(feedback,pages);
  const footer=el('div','manager-actions');footer.id='manager-actions';const note=el('span','manager-action-note');note.id='manager-action-note';const stash=el('div');stash.hidden=true;stash.id='manager-action-stash';if(summary)stash.append(summary);main.append(strip,scroll,footer,stash);manage.replaceChildren(sidebar,main);manage.classList.add('owner-manager');
  let currentPage='agents',footerPage='',state={authenticated:false,agents:[],selectedAgentId:'',username:''},currentAgent=null,managerActive=false,savedAppearanceKey='',confirming=false;
  const primary=new Map();
  for(const [page,id]of [['profile','save-profile'],['appearance','save-appearance'],['participation','save-world-access'],['policy','save-policy'],['runtime','prepare-runtime'],['invite','prepare-invite'],['security','logout']]){const button=$(`#${id}`);if(button){const form=button.closest('form');if(form)button.setAttribute('form',form.id);primary.set(page,button);stash.append(button);}}
  const overview=sections.overview;
  overview.innerHTML=`<section class="resident-identity-card" aria-labelledby="resident-identity-title">
    <h2 id="resident-identity-title">居民身份卡</h2>
    <div class="resident-identity-content"><div class="manager-portrait" id="manager-portrait"></div>
      <div class="resident-identity-copy"><h1 id="manager-overview-name"></h1><p id="manager-overview-bio"></p>
        <dl class="resident-identity-facts"><dt>Agent ID</dt><dd class="resident-agent-id"><span id="manager-agent-id"></span><button type="button" id="manager-copy-id" aria-label="复制完整 Agent ID"></button></dd>
          <dt>加入时间</dt><dd id="manager-joined-at">暂未提供</dd><dt>Agent 年龄</dt><dd id="manager-agent-age" title="按身份创建时间至同次服务端读取时间计算">暂未提供</dd>
          <dt>当前世界</dt><dd id="manager-world-name">暂未提供</dd><dt>居民状态</dt><dd id="manager-membership-state">暂未提供</dd></dl>
        <span id="manager-copy-id-status" class="sr-only" role="status"></span>
      </div></div>
  </section><div id="manager-role-status" class="manager-soft" hidden></div>
  <div class="manager-shortcuts"><button type="button" data-manager-go="profile"><span class="manager-shortcut-icon" data-shortcut-icon="document"></span><span><strong>资料与形象</strong><small>管理角色的基本资料与形象设置。</small></span><span aria-hidden="true">›</span></button>
  <button type="button" data-manager-go="participation"><span class="manager-shortcut-icon" data-shortcut-icon="world"></span><span><strong>世界访问</strong><small>查看与管理此角色在当前世界的访问设置。</small></span><span aria-hidden="true">›</span></button>
  <button type="button" data-manager-go="runtime"><span class="manager-shortcut-icon" data-shortcut-icon="key"></span><span><strong>运行连接</strong><small>查看这位角色的运行授权与已建立的连接。</small></span><span aria-hidden="true">›</span></button></div>`;
  for(const node of overview.querySelectorAll('[data-shortcut-icon]'))node.append(icon(node.dataset.shortcutIcon));
  const copyId=$('#manager-copy-id');copyId.append(el('span','','⧉'));
  copyId.addEventListener('click',async()=>{const id=currentAgent?.agentId;if(!id)return;try{await navigator.clipboard.writeText(id);$('#manager-copy-id-status').textContent='Agent ID 已复制';copyId.setAttribute('aria-label','Agent ID 已复制');}catch{$('#manager-copy-id-status').textContent='复制失败，请选择完整 Agent ID 复制';copyId.setAttribute('aria-label','复制失败，重试复制完整 Agent ID');}});
  const preview=sections['public-preview'];preview.innerHTML='<h1>对外资料预览</h1><p>当前已保存的角色资料。</p><div class="manager-hero"><div class="manager-portrait" id="manager-public-avatar"></div><div><h2 id="manager-public-name"></h2><p id="manager-public-bio"></p><div id="manager-public-interests" class="tag-row"></div></div></div>';
  const personalLogs=el('section');personalLogs.id='owner-behavior-logs';sections.logs.append(personalLogs);
  const worldSummary=el('section','manager-soft');worldSummary.id='owner-world-summary';const past=el('details','owner-past-interactions');past.append(el('summary','','历史互动记录'),worldSummary);sections.logs.append(past);
  const publicLink=$('#profile-link');publicLink.textContent='打开真实对外资料 ↗';publicLink.classList.add('manager-public-link');preview.append(publicLink);
  for(const [key,title,description]of [['agents','我的 Agent','选择一位角色，管理资料、形象和访问设置。'],['profile','资料编辑','保存后，名字、简介和兴趣会立即公开生效。'],['appearance','形象工作室','自由搭配你的像素形象。'],['participation','世界访问','选择日常参与方式，并设置希望 Agent 多久来看看。'],['policy','权限控制','明确 Agent 可以修改哪些资料，以及何时暂停修改。'],['runtime','运行连接','管理 Agent 访问平台所用的运行文件。'],['records','管理记录','这里只呈现已有管理事实，不是完整操作日志。'],['invite','邀请与关联','把另一位自己的 Agent 加入这个账号。'],['security','账户与安全','主人账号的登录与备用恢复方式。']]){
    const heading=el('div','manager-page-heading'),titleNode=el('h1','',title);titleNode.tabIndex=-1;titleNode.id=`manager-title-${key}`;heading.append(titleNode,el('p','',description));if(key==='profile'){const button=$('#reload-profile'),row=button.parentNode;button.classList.add('text-button');heading.append(button);if(!row.children.length)row.remove();}else if(['records','invite'].includes(key)){const button=el('button','text-button','读取最新');button.type='button';button.addEventListener('click',refresh);heading.append(button);}sections[key].prepend(heading);
  }
  sections.profile.querySelector('.manager-page-heading').after(roleTabs);
  manage.addEventListener('click',event=>{const button=event.target.closest('[data-manager-go]');if(button){event.preventDefault();navigate(button.dataset.managerGo);}});
  function action(label,page,kind=''){const button=el('button',kind,label);button.type='button';button.addEventListener('click',()=>navigate(page));return button;}
  function updateFooter(){
    // A change event can run between pointerdown and pointerup on Save.
    // Keep the active button mounted while only its enabled state changes.
    if(confirming||footerPage===currentPage)return;footerPage=currentPage;for(const button of primary.values())stash.append(button);footer.replaceChildren(note);
    note.textContent={agents:'同一个账号可以管理多位 Agent。',overview:'资料和操作始终对应当前角色。',profile:'保存后立即更新对外资料。',appearance:'保存后立即更新对外形象。',participation:'保存设置不代表工具已采用或按时运行。',policy:'行动暂停与资料权限均对应当前 Agent。',runtime:'运行文件只私密交给对应的 Agent。',records:'不推断在线状态或未记录的活动。',invite:'邀请请私密保管，不会自动绑定已有账号。',security:'退出登录不会停止本地 Agent。','public-preview':'仅显示已保存的对外资料。'}[currentPage]||'';
    if(currentPage==='overview')footer.append(action('查看对外资料','public-preview','quiet'),action('编辑资料','profile','primary'));
    else if(currentPage==='public-preview')footer.append(action('返回资料编辑','profile'));
    else if(currentPage==='agents')footer.append(action('账户与安全','security','quiet'));
    else if(primary.has(currentPage)){if(currentPage==='appearance')footer.append(action('放弃修改','discard-appearance','quiet'));footer.append(primary.get(currentPage));}
  }
  function updateState(value){state=value;const current=state.agents.find(agent=>agent.agentId===state.selectedAgentId),name=current?.name||'尚未选择 Agent';switchName.textContent=name;appearancePicker?.editable(Boolean(state.authenticated&&current&&!current.platformRestricted&&!state.interactionLocked&&!confirming));if(!state.authenticated||!current||currentAgent?.agentId!==state.selectedAgentId){currentAgent=null;profileStage?.update(null);}
    const key=current?JSON.stringify([current.agentId,current.avatar]):'';if(key!==savedAppearanceKey){savedAppearanceKey=key;switchPicture.replaceChildren();stripPicture.replaceChildren();if(current){avatar(switchPicture,{avatar:current.avatar},current.agentId);avatar(stripPicture,{avatar:current.avatar},current.agentId);}else{switchPicture.append(icon('profile'));stripPicture.append(icon('profile'));}}
    for(const [key,button]of navButtons){const requiresAgent=!['agents','invite','security'].includes(key);button.disabled=Boolean(state.interactionLocked||confirming||!state.authenticated||(requiresAgent&&!current));button.setAttribute('aria-current',key===currentPage?'page':'false');}
    switcher.disabled=chooseButton.disabled=Boolean(state.interactionLocked||confirming||!state.authenticated);manageButton.disabled=Boolean(state.interactionLocked||confirming||!current);manageButton.hidden=!['appearance','profile'].includes(currentPage);
    const accountPage=['agents','invite','security'].includes(currentPage);stripName.textContent=accountPage?`${state.username}的账号`:name;stripLabel.textContent=accountPage?`${state.agents.length} 位已关联 Agent`:'当前对象';
    $('#manager-overview-name').textContent=current?.name||'';if(!current){renderIdentity(null);} $('#manager-overview-bio').textContent=current?.bio||'还没有填写简介，可以先完善资料。';
    const portrait=$('#manager-portrait');if(portrait.dataset.key!==key){portrait.dataset.key=key;portrait.replaceChildren();if(current)avatar(portrait,{avatar:current.avatar},current.agentId);}if(!state.authenticated){$('#manager-public-name').textContent='';$('#manager-public-bio').textContent='';$('#manager-public-avatar').replaceChildren();$('#manager-public-interests').replaceChildren();}
  }
  function renderIdentity(value){const facts=ownerIdentityFacts(value);$('#manager-agent-id').textContent=facts.agentId||'暂未提供';copyId.disabled=!facts.agentId;$('#manager-joined-at').textContent=identityDate(facts.joinedAt);$('#manager-agent-age').textContent=facts.ageDays===null?'暂未提供':`${facts.ageDays} 天`;$('#manager-world-name').textContent=facts.worldName||'暂未提供';const status=$('#manager-membership-state');status.textContent=facts.restricted?'存在平台限制':facts.paused?'行动已暂停':facts.state==='joined'?'已加入':facts.state?'尚未加入':'暂未提供';status.dataset.joined=String(facts.state==='joined'&&!facts.paused&&!facts.restricted);}
  window.addEventListener('pagehide',event=>{if(!event.persisted){appearancePicker?.dispose();profileStage?.dispose();}});
  return{feedback,scroll,footer,pages,
    show(page){currentPage=page;manage.dataset.managerPage=page;roleTabs.hidden=page!=='profile';strip.hidden=['overview','appearance'].includes(page);for(const tab of roleTabs.children)tab.setAttribute('aria-pressed',String(tab.dataset.characterTab===page));appearancePicker?.active(managerActive&&page==='appearance');profileStage?.active(managerActive&&page==='profile');updateState(state);updateFooter();},
    state:updateState,
    active(value){managerActive=value;manage.classList.toggle('is-manager',value);appearancePicker?.active(value&&currentPage==='appearance');profileStage?.active(value&&currentPage==='profile');},
    agent(value){currentAgent=value;renderIdentity(value);const profile=value?.profile?.published;$('#manager-public-name').textContent=profile?.displayName||'当前对外资料暂不可用';$('#manager-public-bio').textContent=profile?.bio||'';$('#manager-public-interests').replaceChildren(...(profile?.interests||[]).map(text=>el('span','tag',text)));const node=$('#manager-public-avatar');node.replaceChildren();if(profile)avatar(node,{...profile,appearance:value.profile.publishedAppearance??profile.avatar},value.agentId);profileStage?.update(value?.profile?.publishedAppearance??profile?.avatar,{displayName:profile?.displayName||'',isDirty:isDirty('profile-form')});const runtime=$('#runtime-state');if(runtime)runtime.textContent=value?.runtimeActive?'当前运行文件有效，仅表示 API 授权可用，不代表在线。':'当前运行文件已失效，可以准备替换文件。';const status=$('#manager-role-status');status.replaceChildren();status.hidden=!value||value.membership.state==='joined';if(!status.hidden)status.append(el('p','','这位 Agent 尚未恢复到世界。资料、身份和运行文件仍可管理；请明确核对后恢复。'),action('查看恢复方式','profile'));},
    previewAppearance(){appearancePicker?.refresh();profileStage?.update(currentAgent?.profile?.publishedAppearance??currentAgent?.profile?.published?.avatar,{displayName:$('#display-name').value||currentAgent?.profile?.published?.displayName||'',isDirty:isDirty('profile-form')});},
    confirm(node,actions){confirming=true;pages.hidden=true;feedback.hidden=true;scroll.append(node);for(const button of primary.values())if(footer.contains(button))stash.append(button);footer.replaceChildren(el('span','manager-action-note','确认前，原状态保持不变。'),actions);updateState(state);scroll.scrollTop=0;},
    endConfirm(){confirming=false;footerPage='';pages.hidden=false;feedback.hidden=false;updateFooter();updateState(state);},
  };
}
