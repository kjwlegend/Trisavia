import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createLocalHttpAlias } from '../../scripts/local-http-alias.ts';

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return address.port;
}
function read(port: number, path: string, method = 'GET', body: Buffer = Buffer.alloc(0)) {
  return new Promise<{status: number; headers: http.IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: { host: '127.0.0.1:18993', origin: 'http://127.0.0.1:18993', authorization: 'Bearer synthetic-test-only', cookie: 'synthetic=test', 'content-length': body.length } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject); request.end(body);
  });
}

test('loopback alias forwards methods, exact path/query, binary body and audience headers without choosing a target from the URL', async t => {
  const seen: { method: string; path: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  const echo = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks); seen.push({ method: request.method!, path: request.url!, headers: request.headers, body });
    response.writeHead(207, { 'content-type': 'application/octet-stream', 'set-cookie': ['one=1; HttpOnly', 'two=2'], 'x-echo': 'unchanged' }); response.end(body);
  });
  const upstreamPort = await listen(echo), alias = createLocalHttpAlias(upstreamPort), port = await listen(alias.server);
  t.after(async () => { await alias.close(); await new Promise<void>(resolve => echo.close(() => resolve())); });
  const body = Buffer.from([0, 255, 13, 10, 42]), path = '/relative/api?exact=%2F%26&twice=1&twice=2';
  const response = await read(port, path, 'PATCH', body);
  assert.equal(response.status, 207); assert.deepEqual(response.body, body); assert.deepEqual(response.headers['set-cookie'], ['one=1; HttpOnly', 'two=2']); assert.equal(response.headers['x-echo'], 'unchanged');
  assert.equal(seen[0]!.method, 'PATCH'); assert.equal(seen[0]!.path, path); assert.deepEqual(seen[0]!.body, body);
  for (const [header, value] of Object.entries({ host: '127.0.0.1:18993', origin: 'http://127.0.0.1:18993', authorization: 'Bearer synthetic-test-only', cookie: 'synthetic=test' })) assert.equal(seen[0]!.headers[header], value);
  assert.equal((await read(port, '/', 'HEAD')).body.length, 0);
  const rejected = await read(port, 'http://example.invalid/elsewhere'); assert.equal(rejected.status, 400); assert.equal(seen.length, 2);
});

test('streaming responses reach the client before completion and shutdown closes an unfinished stream within its grace window', async t => {
  let finish: (() => void) | undefined;
  const echo = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: first\n\n'); finish = () => response.end('data: last\n\n'); });
  const upstreamPort = await listen(echo), alias = createLocalHttpAlias(upstreamPort), port = await listen(alias.server);
  t.after(async () => { await alias.close(); echo.closeAllConnections(); await new Promise<void>(resolve => echo.close(() => resolve())); });
  const request = http.get({ hostname: '127.0.0.1', port, path: '/stream' });
  const [response] = await once(request, 'response') as [http.IncomingMessage]; response.on('error', () => {});
  const [first] = await once(response, 'data'); assert.equal(String(first), 'data: first\n\n');
  const closed = new Promise<void>(resolve => response.once('close', resolve)); const start = Date.now(); await alias.close(); await closed;
  assert.ok(Date.now() - start < 3_500); finish?.();
});

test('an unavailable loopback upstream returns a bounded generic error without request material', async t => {
  const unused = http.createServer(), port = await listen(unused); await new Promise<void>(resolve => unused.close(() => resolve()));
  const alias = createLocalHttpAlias(port), aliasPort = await listen(alias.server); t.after(() => alias.close());
  const response = await read(aliasPort, '/private?synthetic=query');
  assert.equal(response.status, 502); assert.equal(response.body.toString(), 'Local upstream is unavailable.'); assert.equal(response.headers['cache-control'], 'no-store');
});
