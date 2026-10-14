import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { loadBackendConfig } from '../../apps/platform/configuration/backend-config.ts';

test('default factory ignores forwarding metadata even from loopback', async () => {
  const app = buildApp();
  app.get('/test-client', (request) => ({ ip: request.ip, host: request.host, protocol: request.protocol }));
  try {
    for (const remoteAddress of ['127.0.0.1', '::1', '198.51.100.10']) {
      const response = await app.inject({
        url: '/test-client', remoteAddress,
        headers: { host: 'origin.local', 'x-forwarded-for': '203.0.113.90', 'x-forwarded-host': 'spoofed.invalid', 'x-forwarded-proto': 'https' },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { ip: remoteAddress, host: 'origin.local', protocol: 'http' });
    }
  } finally { await app.close(); }
});

test('opt-in trusts only the direct loopback peer and the closest forwarded client', async () => {
  const app = buildApp(loadBackendConfig({ M1_DATABASE_PATH: ':memory:', M1_TRUST_PROXY_LOOPBACK: '1' }));
  app.get('/test-client', (request) => ({ ip: request.ip, ips: request.ips, host: request.host, protocol: request.protocol }));
  try {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const response = await app.inject({
        url: '/test-client', remoteAddress,
        headers: { 'x-forwarded-for': '203.0.113.90, 198.51.100.10', 'x-forwarded-host': 'public.example', 'x-forwarded-proto': 'https' },
      });
      assert.deepEqual(response.json(), { ip: '198.51.100.10', ips: [remoteAddress, '198.51.100.10'], host: 'public.example', protocol: 'https' });
    }
    // A forwarded loopback address does not make any earlier user-supplied hop trusted.
    const extra = await app.inject({ url: '/test-client', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.90, ::1' } });
    assert.equal(extra.json().ip, '::1');
    for (const remoteAddress of ['198.51.100.10', '127.0.0.2', '::ffff:127.0.0.2']) {
      const response = await app.inject({
        url: '/test-client', remoteAddress,
        headers: { host: 'origin.local', 'x-forwarded-for': '203.0.113.90', 'x-forwarded-host': 'spoofed.invalid', 'x-forwarded-proto': 'https' },
      });
      assert.deepEqual(response.json(), { ip: remoteAddress, ips: [remoteAddress], host: 'origin.local', protocol: 'http' });
    }
  } finally { await app.close(); }
});

test('client quotas follow the verified peer rather than arbitrary forwarded prefixes', async (t) => {
  for (const scenario of [
    { name: 'default ignores XFF', enabled: false, remoteAddress: '127.0.0.1', suffix: '' },
    { name: 'untrusted remote ignores XFF', enabled: true, remoteAddress: '198.51.100.10', suffix: '' },
    { name: 'local proxy uses its appended client', enabled: true, remoteAddress: '127.0.0.1', suffix: ', 198.51.100.10' },
  ]) {
    await t.test(scenario.name, async () => {
      const app = buildApp({ trustProxyLoopback: scenario.enabled });
      const request = (prefix: string, suffix = scenario.suffix, remoteAddress = scenario.remoteAddress) => app.inject({
        url: '/v1/capabilities', remoteAddress, headers: { 'x-forwarded-for': `${prefix}${suffix}` },
      });
      try {
        for (let count = 0; count < 240; count++) {
          assert.equal((await request(`203.0.113.${count % 250 + 1}`)).statusCode, 200);
        }
        const limited = await request('192.0.2.99');
        assert.equal(limited.statusCode, 429);
        assert.equal(limited.json().error.code, 'quota_exceeded');
        const other = scenario.suffix
          ? await request('192.0.2.99', ', 198.51.100.20')
          : await request('192.0.2.99', '', '198.51.100.20');
        assert.equal(other.statusCode, 200, 'A different verified client retains its independent quota');
      } finally { await app.close(); }
    });
  }
});

test('proxy opt-in keeps the 16 KiB API body boundary', async () => {
  for (const trustProxyLoopback of [false, true]) {
    const app = buildApp({ trustProxyLoopback });
    try {
      assert.equal(app.initialConfig.bodyLimit, 16 * 1024);
      for (const size of [16 * 1024, 16 * 1024 + 1]) {
        const payload = JSON.stringify({ padding: 'x'.repeat(size - 14) });
        assert.equal(Buffer.byteLength(payload), size);
        const response = await app.inject({
          method: 'POST', url: '/v1/registrations', remoteAddress: '127.0.0.1',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' }, payload,
        });
        assert.equal(response.statusCode, size > 16 * 1024 ? 413 : 400);
        assert.equal(response.json().error.code, 'invalid_request');
        assert.equal(response.body.includes('xxxx'), false);
      }
    } finally { await app.close(); }
  }
});
