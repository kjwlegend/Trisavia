import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldRuleset } from '../../apps/platform/domains/world/types.ts';
import { assertRuleset, containingPlace, DEFAULT_WORLD_RULES, validatePath } from '../../apps/platform/domains/world/rules.ts';

test('world movement uses integer logical adjacency and rejects walls, diagonals, jumps, closed places and boundaries', () => {
  const rules: WorldRuleset = structuredClone(DEFAULT_WORLD_RULES); rules.blocked = [{ x: 2, y: 0 }]; assertRuleset(rules);
  assert.deepEqual(validatePath(rules, { x: 0, y: 0 }, [{ x: 1, y: 0 }, { x: 1, y: 1 }]), [{ x: 1, y: 0 }, { x: 1, y: 1 }]);
  for (const path of [[{ x: 1, y: 1 }], [{ x: 3, y: 0 }], [{ x: -1, y: 0 }], [{ x: 0.5, y: 0 }], [{ x: 1, y: 0 }, { x: 2, y: 0 }]]) assert.throws(() => validatePath(rules, { x: 0, y: 0 }, path));
  rules.places = [{ id: 'closed', bounds: { left: 1, right: 1, top: 0, bottom: 1 }, access: 'closed', capacity: null }];
  assert.throws(() => validatePath(rules, { x: 0, y: 0 }, [{ x: 1, y: 0 }]), { code: 'place_not_accessible' });
  assert.equal(containingPlace(rules, { x: 0, y: 0 }), undefined);
});
test('world rules reject overlapping places, invalid capacities and unbounded paths without deriving coordinates from artwork', () => {
  const rules: WorldRuleset = structuredClone(DEFAULT_WORLD_RULES); rules.places.push({ ...rules.places[0]!, id: 'overlap' }); assert.throws(() => assertRuleset(rules));
  const valid: WorldRuleset = structuredClone(DEFAULT_WORLD_RULES); valid.maxPathLength = 1; assert.throws(() => validatePath(valid, { x: 0, y: 0 }, [{ x: 1, y: 0 }, { x: 2, y: 0 }]));
  valid.places[0]!.capacity = 0; assert.throws(() => assertRuleset(valid));
});
