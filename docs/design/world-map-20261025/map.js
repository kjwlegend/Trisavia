(() => {
  'use strict';
  const data = window.TrisaviaAtlasData;
  const modal = document.getElementById('world-map');
  const entry = document.getElementById('map-entry');
  const details = document.getElementById('details');
  const regionLabels = document.getElementById('region-labels');
  const pins = document.getElementById('destination-pins');
  const breadcrumbs = document.getElementById('breadcrumbs');
  const enter = document.getElementById('destination-enter');
  const secondary = document.getElementById('secondary-preview');
  const currentRegion = data.regions.find(r => r.destinations.some(d => d.id === data.currentDestinationId));
  let region = currentRegion;
  let selected = region.destinations.find(d => d.id === data.currentDestinationId);
  let mode = 'region';
  let lastTrigger = entry;
  const icons = {
    town:'<path d="m3 11 9-7 9 7M5 10v11h14V10M10 21v-7h4v7M8 10h2m4 0h2"/>',
    landscape:'<path d="m2 20 7-13 5 8 3-5 5 10ZM9 7l3 6M5 20h16"/>',
    place:'<path d="M5 21V7h14v14M9 7V3h6v4M3 21h18M9 11h1m4 0h1m-6 4h1m4 0h1M11 21v-3h2v3"/>'
  };
  const icon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind === '城镇' ? 'town' : kind === '场所' ? 'place' : 'landscape']}</svg>`;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isOpen = destination => destination && destination.id === data.currentDestinationId && destination.state === 'open' && destination.worldId === 'default';
  const stateTag = d => `<span class="state-tag ${isOpen(d) ? 'open' : ''}">${isOpen(d) ? '已开放' : '未开放'}</span>`;
  function fitMap() {
    const area = document.querySelector('.cartography');
    const stage = document.getElementById('map-stage');
    const width = Math.max(0, Math.min(area.clientWidth, area.clientHeight * 1000 / 640));
    stage.style.width = `${width}px`;
    stage.style.height = `${width * 640 / 1000}px`;
  }
  function selectRegion(id, focusDetails = false) {
    const next = data.regions.find(r => r.id === id);
    if (!next) return;
    region = next;
    selected = region.destinations.find(isOpen) || null;
    mode = 'region';
    render();
    if (focusDetails) details.querySelector('h3').focus();
  }
  function selectDestination(id) {
    const nextRegion = data.regions.find(r => r.destinations.some(d => d.id === id));
    if (!nextRegion) return;
    region = nextRegion;
    selected = region.destinations.find(d => d.id === id);
    mode = 'destination';
    render();
    details.querySelector('h3').focus();
  }
  function render() {
    regionLabels.innerHTML = data.regions.map(r => `<button class="region-label" data-region="${r.id}" style="left:${r.anchor.x}%;top:${r.anchor.y}%" aria-pressed="${r.id === region.id}" aria-label="查看${escape(r.name)}，${r.state === 'partial' ? '仅清昼小镇开放' : '未开放地区'}">${escape(r.name)}<small>${r.state === 'partial' ? '出生地区 · 局部开放' : '未开放'}</small></button>`).join('');
    const shownPins = [...region.destinations];
    const current = currentRegion.destinations.find(d => d.id === data.currentDestinationId);
    if (!shownPins.some(d => d.id === current.id)) shownPins.push(current);
    pins.innerHTML = shownPins.map(d => `<button class="pin ${isOpen(d) ? 'current' : ''} ${selected?.id === d.id ? 'selected' : ''}" style="left:${d.anchor.x}%;top:${d.anchor.y}%" data-destination="${d.id}" aria-label="${escape(d.name)}，${isOpen(d) ? '当前镇，已开放' : '未开放，查看规划'}"><i class="pin-dot"></i>${isOpen(d) || selected?.id === d.id ? `<span class="pin-name">${escape(d.name)}${isOpen(d) ? ' · 当前' : ''}</span>` : ''}</button>`).join('');
    document.getElementById('region-outline').setAttribute('href', `assets/world-map.svg#${region.pathId}`);
    breadcrumbs.innerHTML = `<button data-region="${currentRegion.id}">Trisavia</button><span class="chevron" aria-hidden="true">›</span><button class="${mode === 'region' ? 'active' : ''}" data-region="${region.id}" ${mode === 'region' ? 'aria-current="location"' : ''}>${escape(region.name)}</button>${mode === 'destination' ? `<span class="chevron" aria-hidden="true">›</span><span class="active" style="font-size:12px" aria-current="location">${escape(selected.name)}</span>` : ''}`;
    if (mode === 'region') {
      details.innerHTML = `<div class="detail-kicker">${escape(region.subtitle)} <span class="state-tag ${region.state === 'partial' ? 'open' : ''}">${region.state === 'partial' ? '局部开放' : '未开放'}</span></div><h3 tabindex="-1">${escape(region.name)}</h3><p>${escape(region.summary)}</p><div class="section-label"><span>城镇与场景</span><span>${region.destinations.length} 处</span></div><ul class="destination-list">${region.destinations.map(d => `<li><button class="destination-row ${isOpen(d) ? 'selected' : ''}" data-destination="${d.id}"><span class="destination-symbol">${icon(d.kind)}</span><span><strong>${escape(d.name)}</strong><small>${escape(d.kind)} · ${isOpen(d) ? '当前镇 · 已开放' : '规划中 · 未开放'}</small></span><span class="row-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ul><p class="region-footnote">${region.state === 'partial' ? '目前仅清昼小镇开放，初晓洲的其他地点仍在规划中。' : '这片远方还没有开放。等道路与场景准备好，我们会在世界公告里告诉大家。'}</p>`;
    } else {
      details.innerHTML = `<button class="detail-back" data-region="${region.id}">← 返回${escape(region.name)}</button><div class="detail-kicker">${escape(selected.kind)} ${stateTag(selected)}</div><h3 tabindex="-1">${escape(selected.name)}</h3><p>${escape(selected.summary)}</p>${selected.places.length ? `<div class="section-label">${isOpen(selected) ? '镇中场所' : '规划中的场所'}</div><ul class="place-chips">${selected.places.map(p => `<li>${escape(p)}</li>`).join('')}</ul>` : ''}<p class="detail-note">${isOpen(selected) ? '返回小镇后，可在当前地图中查看场所。宏观地图不提供移动或跨城传送。' : '这里只展示未来的世界设想。地点与场所尚未开放，不能进入。'}</p>`;
    }
    const available = isOpen(selected);
    enter.disabled = !available;
    enter.innerHTML = available ? '回到小镇地图 <span aria-hidden="true">↗</span>' : '尚未开放';
    document.getElementById('availability-note').textContent = available ? '当前镇 · 已开放' : '未来地域 · 暂无入口';
    details.scrollTop = 0;
  }
  function openMap(trigger) {
    lastTrigger = trigger || entry;
    document.getElementById('status').textContent = '';
    selectRegion(currentRegion.id);
    if (!modal.open) modal.showModal();
    fitMap();
    document.getElementById('close-map').focus();
  }
  function closeMap() { if (modal.open) modal.close(); }
  [regionLabels, pins, breadcrumbs, details].forEach(container => container.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.region) selectRegion(button.dataset.region, true);
    if (button.dataset.destination) selectDestination(button.dataset.destination);
  }));
  entry.addEventListener('click', () => openMap(entry));
  document.getElementById('hero-map-entry').addEventListener('click', event => openMap(event.currentTarget));
  document.getElementById('close-map').addEventListener('click', closeMap);
  modal.addEventListener('close', () => lastTrigger.focus());
  modal.addEventListener('click', event => {
    const r = modal.getBoundingClientRect();
    if (event.target === modal && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) closeMap();
  });
  document.getElementById('locate-current').addEventListener('click', () => {
    selectRegion(currentRegion.id);
    const pin = pins.querySelector('.current');
    pin.dataset.located = 'true';
    pin.focus();
  });
  enter.addEventListener('click', () => {
    if (!isOpen(selected)) return;
    closeMap();
    document.getElementById('status').textContent = '已返回清昼小镇 · 此页为设计原型';
  });
  const pageAdvice = {
    releases:{title:'更新日志',body:'<p>每个版本一张阅读卡，按真实发布状态展示。这里是排版说明，没有示例版本冒充已发布。</p><div class="sample-block"><strong>版本名称</strong><p>发布日期 · 真实状态</p><p>新增、优化、修复分别用简短段落呈现。</p></div>'},
    kanban:{title:'建设看板',body:'<p>只展示本批世界地图与地区场景扩展的真实事项。尚无投票服务时，只提供征询说明。</p><div class="sample-columns"><div class="sample-column">进行中<p>正在实施的事项</p></div><div class="sample-column">已完成<p>以真实交付为准</p></div><div class="sample-column">未来计划<p>尚待展开的远方</p></div><div class="sample-column">投票中<p>暂未开放投票</p></div></div>'}
  };
  for (const page of ['releases','kanban']) document.getElementById(page === 'releases' ? 'release-link' : 'kanban-link').addEventListener('click', event => {
    event.preventDefault();
    lastTrigger = event.currentTarget;
    document.getElementById('secondary-title').textContent = pageAdvice[page].title;
    document.getElementById('secondary-content').innerHTML = pageAdvice[page].body;
    secondary.showModal();
  });
  document.getElementById('close-secondary').addEventListener('click', () => secondary.close());
  document.getElementById('secondary-return').addEventListener('click', () => secondary.close());
  secondary.addEventListener('close', () => lastTrigger.focus());
  // Keep first/last keyboard focus in the active dialog, including reverse Tab.
  for (const dialog of [modal, secondary]) dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  new ResizeObserver(fitMap).observe(document.querySelector('.cartography'));
  openMap(entry);
})();
