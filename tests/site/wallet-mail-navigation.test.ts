import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The browser production module intentionally has no TS declaration.
import { inventoryNavigationFields, readSavedInventoryNavigation, readSavedMailNavigation, projectSavedInventorySelection } from '../../apps/web/public/hud/features/platform-content.js';

test('mail navigation defaults missing or invalid scoped records to messages; inventory persists only authorized navigation fields', () => {
  for (const raw of [null, '', '{broken', 'null', '{}', JSON.stringify({ category: 'invented', views: {} })]) {
    assert.equal(readSavedMailNavigation(raw).category, 'messages');
  }
  assert.equal(readSavedMailNavigation('announcements').category, 'announcements', 'The previous category-only format remains usable');
  assert.equal(readSavedMailNavigation(JSON.stringify({ category: 'events', views: { events: { top: 128 } } })).category, 'events');
  const permitted = { category: 'prop', selected: '["inventory","inventory.holding@1","own-ref"]', top: 145, detailTop: 72 };
  const legacy = { ...permitted, query: 'private search text', balance: 17, title: 'private title', sender: 'private sender', body: 'private body' };
  assert.deepEqual(inventoryNavigationFields(legacy), permitted);
  assert.deepEqual(readSavedInventoryNavigation(JSON.stringify(legacy)), permitted);
  assert.deepEqual(readSavedInventoryNavigation('{broken'), { category: 'all', selected: '', top: 0, detailTop: 0 });
});

test('later-page inventory reference and positions remain pending through partial/failing enumeration; only complete absence permits fallback', () => {
  const first = { ref: { moduleId: 'inventory', type: 'inventory.holding@1', id: 'first' }, version: 1 },
    later = { ref: { moduleId: 'inventory', type: 'inventory.holding@1', id: 'later' }, version: 1 };
  const view = { selected: JSON.stringify(['inventory', 'inventory.holding@1', 'later']), top: 720, detailTop: 84 };
  const preserved = structuredClone(view);
  for (const phase of ['loading', 'ready', 'partial']) {
    assert.deepEqual(projectSavedInventorySelection(view, { phase, complete: false, records: [first] }, [first]), { chosen: null, pending: true });
    assert.deepEqual(view, preserved, 'An incomplete result cannot replace the saved reference or clipped scroll positions');
  }
  assert.deepEqual(projectSavedInventorySelection(view, { complete: true, records: [first, later] }, [first, later]), { chosen: later, pending: false });
  assert.deepEqual(view, preserved);
  assert.deepEqual(projectSavedInventorySelection(view, { complete: true, records: [first] }, [first]), { chosen: first, pending: false });
  assert.equal(view.selected, JSON.stringify(['inventory', 'inventory.holding@1', 'first']));
  assert.equal(view.top, 0); assert.equal(view.detailTop, 0);
});
