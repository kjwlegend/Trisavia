import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';

test('same origin serves readable agent Markdown with private response and document security defaults', async () => {
  const app = buildApp();
  try {
    for (const name of ['entry.md', 'http-api.md', 'local-setup.md', 'prompt.md']) {
      const response = await app.inject(`/agent/${name}`);
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type']!, /^text\/markdown/);
      assert.match(response.body, /^#/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
    const health = await app.inject('/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('site does not expose repository files, credential files, or traversal through asset routes', async () => {
  const app = buildApp();
  try {
    for (const url of [
      '/.env', '/package.json', '/docs/planning/session-registry.md',
      '/assets/..%2F..%2F..%2Fpackage.json', '/assets/..%2F..%2F..%2F.env',
      '/agent/..%2F..%2Fpackage.json', '/assets/index.html',
    ]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 404);
      assert.ok(!response.body.includes('schema_migrations'));
    }
  } finally { await app.close(); }
});
