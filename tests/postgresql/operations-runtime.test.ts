import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkedImage, checkedProject, dockerContext, ensureAvailablePort, initializeRuntime, readRuntime } from '../../scripts/postgresql/runtime.ts';

const pinned = `postgres:18.6-trixie@sha256:${'1'.repeat(64)}`;
test('local runtime initialization writes independent private role secrets without overwriting an existing runtime', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'connet-pg-ops-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done)); const address = probe.address(); assert(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  const path = await initializeRuntime(join(directory, 'private'), 'agents-era-pg-test', port, pinned), config = await readRuntime(path);
  assert.equal(config.context, dockerContext); assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, port);
  assert.equal((await stat(config.privateDir)).mode & 0o777, 0o700);
  for (const file of await readdir(config.privateDir)) assert.equal((await stat(join(config.privateDir, file))).mode & 0o777, 0o600);
  const values = await Promise.all(['admin', 'migration', 'application', 'backup'].map(kind => readFile(join(config.privateDir, `${kind}-password`), 'utf8')));
  assert.equal(new Set(values).size, 4); assert(values.every(value => /^[\w-]{48}$/.test(value)));
  const env = await readFile(join(config.privateDir, 'compose.env'), 'utf8'); assert(values.every(value => !env.includes(value)));
  const before = await readFile(path); await assert.rejects(initializeRuntime(config.privateDir, config.project, port, pinned)); assert((await readFile(path)).equals(before));
});
test('runtime refuses mutable images, unrelated project names and protected or already occupied ports', async t => {
  for (const image of ['postgres:latest', 'postgres:18.6-trixie', pinned.replace('18.6', '17.11'), pinned.replace('postgres:', 'other:')]) assert.throws(() => checkedImage(image));
  assert.equal(checkedImage(pinned), pinned); assert.equal(checkedProject('agents-era-pg'), 'agents-era-pg');
  for (const project of ['default', 'colima', 'agents-era-pg;echo', '../agents-era-pg']) assert.throws(() => checkedProject(project));
  for (const port of [0, 543.5, 8789, 8799, 8801, 8787, 8846, 18892]) await assert.rejects(ensureAvailablePort(port));
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise<void>(done => server.close(() => done())));
  const address = server.address(); assert(address && typeof address !== 'string'); await assert.rejects(ensureAvailablePort(address.port));
});
