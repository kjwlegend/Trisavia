import {RELEASES} from './releases-data.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const list = document.querySelector('#release-list');
const note = element('p', 'product-note', '这里记录已经完成的变化；不同体验入口的更新节奏可能不同。');
list.before(note);
for (const release of RELEASES) {
  const card = element('article', 'paper-sheet release-card');
  const head = element('div', 'release-heading');
  head.append(element('h2', '', `v${release.version} · ${release.title}`));
  const meta = element('div', 'release-meta');
  const date = element('time', '', release.date.replaceAll('-', '.'));
  date.dateTime = release.date;
  meta.append(date, element('span', 'release-status', release.status));
  head.append(meta);
  card.append(head);
  for (const category of ['新增', '优化', '修复']) {
    const changes = release.highlights.filter(change => change.category === category);
    if (!changes.length) continue;
    const group = element('section', 'release-group');
    group.append(element('h3', '', category));
    const points = element('ul', 'release-points');
    for (const change of changes) {
      const point = element('li');
      point.append(element('strong', '', change.title), element('p', '', change.description));
      points.append(point);
    }
    group.append(points);
    card.append(group);
  }
  list.append(card);
}
