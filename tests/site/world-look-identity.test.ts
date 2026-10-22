import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// @ts-expect-error The application intentionally ships native browser JavaScript without declarations.
import { APPEARANCE_CATALOG, APPEARANCE_DIGEST, APPEARANCE_VERSION, drawLook, lookFor, resolveLook } from '../../apps/web/public/world-pixel/look.js';
// @ts-expect-error Exercise the actual World renderer consumer, not a second test resolver.
import { presentationHair } from '../../apps/web/public/world-pixel/human.js';
// @ts-expect-error The actual directory reader also remains native browser JavaScript.
import { readLookCatalogue } from '../../apps/web/public/world-pixel/look-catalogue.js';

const version = '2026-10-21.appearance-v1.1';
const hairs = ['shorthair', 'longhair', 'curlyhair', 'bowlhair', 'mophair', 'spikeyhair'];
const pair = (hair: string) => ({ lookId: 'sunnyside-human-' + hair, catalogVersion: version });

test('the shared production dictionary maps all six stable identities to the frozen original idle/walk PNGs', async () => {
  assert.equal(APPEARANCE_VERSION, version);
  assert.equal(APPEARANCE_DIGEST, '30c00558d539a194e6936b24e0179a2558cad4b047251265231388e9c63c2b82');
  const document = await readFile(new URL('../../apps/web/public/world-pixel/appearance-catalog.json', import.meta.url));
  assert.equal(createHash('sha256').update(document).digest('hex'), APPEARANCE_DIGEST);
  assert.deepEqual(APPEARANCE_CATALOG, JSON.parse(document.toString('utf8')));
  assert.deepEqual(APPEARANCE_CATALOG.appearances.map((look: { key: string }) => look.key), hairs.map(hair => pair(hair).lookId));
  assert.deepEqual(APPEARANCE_CATALOG.shared.frameSize, [96, 64]);
  for (const hair of hairs) {
    const look = resolveLook(pair(hair), { avatarId: 'unrelated-avatar', rendererHair: 'different-legacy-hair' });
    assert.equal(look.key, pair(hair).lookId); assert.deepEqual(look.groundAnchor, [48, 39]);
    for (const action of ['idle', 'walk']) {
      assert.deepEqual(look.clips[action].layers.map((layer: { imageKey: string }) => layer.imageKey), [`human_base_${action}`, `human_${hair}_${action}`]);
      for (const key of [`human_base_${action}`, `human_${hair}_${action}`]) {
        const asset: { url: string; sha256: string } = APPEARANCE_CATALOG.images[key];
        const bytes = await readFile(new URL('../../apps/web/public/world-pixel/' + asset.url, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, 'The renderer consumes the approved original PNG bytes');
      }
    }
    const entry = { agentId: 'must-not-determine-appearance', fact: { id: 'same-avatar', profile: { appearance: pair(hair), publishedVersion: 8 } } };
    assert.equal(presentationHair({}, entry), hair, 'The actual World consumer reads appearance even when Avatar identity and position do not change');
  }
});

test('new identities never fall back to Agent hashes, while legacy resolution requires real evidence', () => {
  assert.equal(resolveLook({ lookId: 'not-a-look', catalogVersion: version }, { avatarId: 'real-avatar' }), null);
  assert.equal(resolveLook({ ...pair('curlyhair'), catalogVersion: 'unknown-version' }, { rendererHair: 'longhair' }), null);
  assert.equal(resolveLook({ template: 'basic', color: 'olive' }), null, 'No original Avatar evidence means unresolved, not a guessed person');
  assert.equal(resolveLook({ template: 'basic', color: 'cream' }, { avatarId: '' }), null);
  assert.equal(resolveLook({ template: 'basic', color: 'unknown' }, { avatarId: 'a' }), null);
  assert.equal(resolveLook({ template: 'basic', color: 'blue' }).key, pair('curlyhair').lookId);
  assert.equal(resolveLook({ template: 'basic', color: 'amber' }).key, pair('longhair').lookId);
  assert.equal(resolveLook({ template: 'basic', color: 'cream' }, { rendererHair: 'longhair' }).key, pair('longhair').lookId);
  // This synthetic original Avatar id is independent of an Agent id and the six-button display order.
  assert.equal(resolveLook({ template: 'basic', color: 'olive' }, { avatarId: 'a' }).nativeHairKey, 'longhair');
  const saved = pair('bowlhair');
  assert.equal(lookFor(saved.lookId).key, saved.lookId, 'Saved identities remain resolvable in the finite art dictionary independently of server selectability');
  const directory = { version: 2, catalogVersion: version, assetVersion: '2026-10-21.r3', catalogDigest: APPEARANCE_DIGEST,
    defaultLookId: pair('shorthair').lookId, looks: hairs.map(hair => ({ lookId: pair(hair).lookId, displayName: hair,
      selectable: hair !== 'bowlhair', preview: { kind: 'layered-sprite', layers: ['/assets/world-pixel/assets/human-base-idle.png', `/assets/world-pixel/assets/human-${hair}-idle.png`],
        frame: { x: 0, y: 0, width: 96, height: 64 }, anchor: { x: 48, y: 39 } } })) };
  assert.equal(readLookCatalogue(directory).looks.find((look: { lookId: string }) => look.lookId === saved.lookId).selectable, false);
  assert.equal(resolveLook(saved).key, saved.lookId, 'A consumer can reject new selection while resolving an existing saved look; no real directory retirement is claimed');
  assert.deepEqual(saved, pair('bowlhair'));
});

test('the actual drawing consumer uses matching layers and degrades without mutating the saved identity', () => {
  const saved = pair('spikeyhair'), before = structuredClone(saved), look = resolveLook(saved);
  const calls: unknown[][] = [], placeholders: unknown[][] = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, imageSmoothingEnabled: true, globalAlpha: 1, fillStyle: '',
    drawImage(...args: unknown[]) { calls.push(args); }, fillRect(...args: unknown[]) { placeholders.push(args); } };
  const base = { asset: 'real-base' }, hair = { asset: 'real-spikeyhair' };
  const images = new Map([['human_base_idle', base], ['human_spikeyhair_idle', hair]]);
  assert.equal(drawLook(ctx, look, images, { action: 'idle', elapsed: 0, still: true }), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [[base, 0, 0, 96, 64, -48, -39, 96, 64], [hair, 0, 0, 96, 64, -48, -39, 96, 64]]);
  calls.length = 0; images.delete('human_spikeyhair_idle');
  assert.equal(drawLook(ctx, look, images, { action: 'idle' }), false);
  assert.equal(calls.length, 0); assert(placeholders.length > 0, 'Missing art uses an explicit placeholder rather than another look');
  assert.deepEqual(saved, before, 'Rendering cannot write a default back to the saved appearance');
});
