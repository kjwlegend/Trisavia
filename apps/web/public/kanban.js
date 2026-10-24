import {BOARD_COLUMNS, MAP_CARDS, WORLD_INTRODUCTION} from './kanban-data.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const introduction = document.querySelector('#world-introduction');
for (const section of [
  {title: '我们想去的方向', lead: WORLD_INTRODUCTION.goal, body: WORLD_INTRODUCTION.vision},
  {title: '今天，从清昼小镇开始', body: WORLD_INTRODUCTION.town},
]) {
  const card = element('article', 'paper-sheet world-intro-card');
  card.append(element('h2', '', section.title));
  if (section.lead) card.append(element('p', 'world-goal', section.lead));
  card.append(element('p', '', section.body));
  introduction.append(card);
}
introduction.after(element('p', 'product-note board-scope', WORLD_INTRODUCTION.scope));
const board = document.querySelector('#map-board');
for (const column of BOARD_COLUMNS) {
  const cards = MAP_CARDS.filter(card => card.column === column.id);
  const section = element('section', 'board-column');
  section.dataset.column = column.id;
  const head = element('div', 'board-heading');
  const title = element('h2', '', column.title);
  title.id = `board-${column.id}`;
  section.setAttribute('aria-labelledby', title.id);
  head.append(title);
  if (column.id !== 'voting') head.append(element('span', 'board-count', `${cards.length}项`));
  section.append(head);
  for (const card of cards) {
    const item = element('article', 'paper-sheet board-card');
    item.dataset.card = card.id;
    const completed = card.column === 'completed' && /^\d+\.\d+\.\d+$/.test(card.completedVersion ?? '');
    const scope = completed ? `${card.scope} · v${card.completedVersion}` : card.scope;
    item.append(element('h3', '', card.title), element('p', '', card.summary), element('span', 'board-card-scope', scope));
    if (completed && card.id === 'map-atlas' && card.experienceHref === '/?atlas=1') {
      const link = element('a', '', '打开新城地图册');
      link.setAttribute('href', card.experienceHref);
      item.append(link);
    }
    section.append(item);
  }
  if (!cards.length) section.append(element('p', 'board-empty', column.empty));
  board.append(section);
}
