import {BOARD_COLUMNS, MAP_CARDS, LIFE_CARDS} from './kanban-data.js';
import {el as element} from './common.js';
import {msg,t,bindText} from './i18n/core.js';
import {mountPublicNavigation} from './public-navigation.js';
const navigation=mountPublicNavigation({namespaces:['kanban']});await navigation.ready;

const introduction = document.querySelector('#world-introduction');
introduction.replaceChildren();
for (const section of [
  {title: msg('kanban:world.directionTitle'), lead: msg('kanban:world.goal'), body: msg('kanban:world.vision')},
  {title: msg('kanban:world.townTitle'), body: msg('kanban:world.town')},
]) {
  const card = element('article', 'paper-sheet world-intro-card');
  card.append(element('h2', '', section.title));
  if (section.lead) card.append(element('p', 'world-goal', section.lead));
  card.append(element('p', '', section.body));
  introduction.append(card);
}
introduction.after(element('p', 'product-note board-scope', msg('kanban:world.scope')));
const board = document.querySelector('#map-board');
board.replaceChildren();
for (const column of BOARD_COLUMNS) {
  const cards = [...MAP_CARDS, ...LIFE_CARDS].filter(card => card.column === column.id);
  if (column.id === 'completed') cards.sort((a, b) => b.completedVersion.localeCompare(a.completedVersion, undefined, {numeric: true}));
  const section = element('section', 'board-column');
  section.dataset.column = column.id;
  const head = element('div', 'board-heading');
  const title = element('h2', '', msg(`kanban:columns.${column.id}.title`));
  title.id = `board-${column.id}`;
  section.setAttribute('aria-labelledby', title.id);
  head.append(title);
  if (column.id !== 'voting') head.append(element('span', 'board-count', msg('kanban:count',{count:cards.length})));
  section.append(head);
  for (const card of cards) {
    const item = element('article', 'paper-sheet board-card');
    item.dataset.card = card.id;
    const completed = card.column === 'completed' && /^\d+\.\d+\.\d+$/.test(card.completedVersion ?? '');
    const scope=element('span','board-card-scope');bindText(scope,completed?'kanban:completedScope':`kanban:cards.${card.id}.scope`,completed?()=>({scope:t(`kanban:cards.${card.id}.scope`),version:card.completedVersion}):undefined);
    item.append(element('h3', '', msg(`kanban:cards.${card.id}.title`)), element('p', '', msg(`kanban:cards.${card.id}.description`)), scope);
    if (completed && card.id === 'map-atlas' && card.experienceHref === '/?atlas=1') {
      const link = element('a', '', msg('public:kanban.openAtlas'));
      link.setAttribute('href', card.experienceHref);
      link.setAttribute('data-locale-link',card.experienceHref);
      item.append(link);
    }
    section.append(item);
  }
  if (!cards.length) section.append(element('p', 'board-empty', msg(`kanban:columns.${column.id}.empty`)));
  board.append(section);
}
navigation.updateLinks();
