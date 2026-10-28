import {RELEASES} from './releases-data.js';
import {el as element} from './common.js';
import {msg} from './i18n/core.js';
import {mountPublicNavigation} from './public-navigation.js';
const navigation=mountPublicNavigation({namespaces:['releases']});await navigation.ready;
const list = document.querySelector('#release-list');
const note = element('p', 'product-note', msg('public:releases.note'));
list.before(note);
for (const release of RELEASES) {
  const card = element('article', 'paper-sheet release-card');
  const head = element('div', 'release-heading');
  const title=element('h2');title.append(document.createTextNode(`v${release.version} · `),element('span','',msg(`releases:releases.${release.version}.title`)));head.append(title);
  const meta = element('div', 'release-meta');
  const date = element('time', '', release.date.replaceAll('-', '.'));
  date.dateTime = release.date;
  meta.append(date, element('span', 'release-status', release.status==='已完成'?msg('public:releases.status.completed'):release.status));
  head.append(meta);
  card.append(head);
  for (const category of ['新增', '优化', '修复']) {
    const changes = release.highlights.filter(change => change.category === category);
    if (!changes.length) continue;
    const group = element('section', 'release-group');
    group.append(element('h3', '', msg('public:releases.category.'+({'新增':'added','优化':'improved','修复':'fixed'}[category]))));
    const points = element('ul', 'release-points');
    for (const change of changes) {
      const point = element('li');
      const index=release.highlights.indexOf(change);point.append(element('strong', '', msg(`releases:releases.${release.version}.summary.${index}.title`)), element('p', '', msg(`releases:releases.${release.version}.summary.${index}.description`)));
      points.append(point);
    }
    group.append(points);
    card.append(group);
  }
  list.append(card);
}
