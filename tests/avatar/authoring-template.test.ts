import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { AVATAR_AUTHORING_ASSETS, AVATAR_AUTHORING_PROMPT } from '../../apps/platform/application/agent-avatar-guide.ts';
import { AUTHORING_FILES, copyAvatarAuthoringTemplate } from '../../scripts/avatar-template.ts';
import { createOriginalAvatarSample } from '../../scripts/avatar-authoring-sample.ts';

const source = new URL('../../apps/web/public/avatar-authoring/v1/', import.meta.url);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Compare tight crops: merely translating the same image cannot produce multiple hashes. */
function poseHashes(image: PNG, frames: number, minimumY = 0): Set<string> {
  const poses = new Set<string>();
  for (let frame = 0; frame < frames; frame++) {
    const points: Array<[number, number, number[]]> = [];
    for (let y = minimumY; y < 64; y++) for (let x = 0; x < 96; x++) {
      const offset = (y * image.width + frame * 96 + x) * 4;
      if (image.data[offset + 3]) points.push([x, y, [...image.data.subarray(offset, offset + 4)]]);
    }
    assert(points.length > 0);
    const minX = Math.min(...points.map(([x]) => x)), minY = Math.min(...points.map(([, y]) => y));
    poses.add(sha(Buffer.from(JSON.stringify(points.map(([x, y, rgba]) => [x - minX, y - minY, rgba])))));
    assert(points.every(([x, y]) => x > 0 && x < 95 && y > 0 && y < 39), 'full character remains inside its cell, above the foot baseline');
  }
  return poses;
}

test('downloadable manifest and PNGs match the frozen strips contract and original reproducible sample', async () => {
  const template = JSON.parse(await readFile(new URL('template.json', source), 'utf8'));
  assert.deepEqual(template, {
    version: 1, type: 'trisavia-avatar-strips', frame: { width: 96, height: 64, foot: { x: 48, y: 39 } },
    facing: { default: 'right', left: 'mirror-about-foot', vertical: 'keep-last-horizontal' },
    clips: { idle: { file: 'idle.png', frames: 9, frameMs: 125 }, walk: { file: 'walk.png', frames: 8, frameMs: 100 } },
    fallback: { work: 'idle', rest: 'idle' },
  });
  assert.deepEqual(JSON.parse(await readFile(new URL('sample.manifest.json', source), 'utf8')), template);
  const generated = createOriginalAvatarSample();
  for (const [kind, frames] of [['idle', 9], ['walk', 8]] as const) {
    const bytes = await readFile(new URL(kind + '.png', source));
    assert.deepEqual(bytes, generated[kind], 'committed art is reproducible without private input or a model');
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    assert.equal(decoded.width, frames * 96); assert.equal(decoded.height, 64);
    assert(decoded.data.some((_value, index) => index % 4 === 3 && decoded.data[index] === 0), 'transparent background');
    assert(poseHashes(decoded, frames).size >= 3, 'idle breathes/blinks and walk changes pose after translation normalization');
    if (kind === 'walk') assert(poseHashes(decoded, frames, 30).size >= 4, 'multiple actual leg/foot poses');
  }
});

test('public prompt uses the current local-only instructions and every published kit path exists', async () => {
  const prompt = JSON.parse(await readFile(new URL('prompt.json', source), 'utf8'));
  assert.equal(prompt.version, 1); assert.equal(prompt.text, AVATAR_AUTHORING_PROMPT);
  for (const path of Object.values(AVATAR_AUTHORING_ASSETS)) {
    assert(path.startsWith('/assets/avatar-authoring/v1/'));
    assert((await stat(new URL(path.slice('/assets/avatar-authoring/v1/'.length), source))).isFile());
  }
});

test('optional offline copy produces only the five public materials and never overwrites an existing workspace', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'trisavia-avatar-kit-'));
  try {
    const destination = join(owned, 'kit');
    assert.deepEqual(await copyAvatarAuthoringTemplate(destination), { files: 5, destination });
    for (const file of AUTHORING_FILES) {
      assert.deepEqual(await readFile(join(destination, file)), await readFile(new URL(file, source)));
      assert.equal((await stat(join(destination, file))).mode & 0o777, 0o600);
    }
    await assert.rejects(copyAvatarAuthoringTemplate(destination));
    await assert.rejects(copyAvatarAuthoringTemplate('relative/path'), /absolute_new_destination_required/);
  } finally { await rm(owned, { recursive: true, force: true }); }
});
