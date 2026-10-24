import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';

const HOST = '127.0.0.1', LISTEN_PORT = 18993, UPSTREAM_PORT = 18893;
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function forwardHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result = { ...headers };
  for (const name of [...HOP_HEADERS, ...(headers.connection || '').split(',').map(value => value.trim().toLowerCase())]) delete result[name];
  return result;
}

// The executable has no host/port options. A loopback port seam lets tests use an isolated echo upstream.
export function createLocalHttpAlias(upstreamPort = UPSTREAM_PORT) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) throw new Error('Invalid loopback upstream port');
  const pending = new Set<http.ClientRequest>();
  const sockets = new Set<Socket>();
  const server = http.createServer({ requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, (request, response) => {
    if (!request.url?.startsWith('/') || request.method === 'CONNECT') {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close' });
      response.end('Only local origin-form HTTP requests are supported.');
      return;
    }
    let timedOut = false;
    const upstream = http.request({ hostname: HOST, port: upstreamPort, method: request.method, path: request.url, headers: forwardHeaders(request.headers), agent: false }, result => {
      response.writeHead(result.statusCode || 502, forwardHeaders(result.headers));
      result.on('error', () => response.destroy());
      result.pipe(response);
    });
    pending.add(upstream);
    upstream.once('close', () => pending.delete(upstream));
    upstream.setTimeout(30_000, () => { timedOut = true; upstream.destroy(); });
    upstream.on('error', () => {
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(timedOut ? 504 : 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'connection': 'close' });
      response.end(timedOut ? 'Local upstream timed out.' : 'Local upstream is unavailable.');
    });
    request.on('aborted', () => upstream.destroy());
    request.on('error', () => { upstream.destroy(); response.destroy(); });
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    response.on('error', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  for (const event of ['connect', 'upgrade'] as const) server.on(event, (_request, socket) => {
    socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => {
        for (const request of pending) request.destroy();
        for (const socket of sockets) socket.destroy();
      }, 2_000);
      force.unref();
      server.close(error => { clearTimeout(force); if (error) reject(error); else resolve(); });
      server.closeIdleConnections();
    });
  }
  return { server, close };
}

if (import.meta.main) {
  const alias = createLocalHttpAlias();
  const stop = () => { void alias.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  alias.server.once('error', () => {
    console.error('Local HTTP alias could not listen on 127.0.0.1:18993.');
    process.exitCode = 1;
  });
  alias.server.listen(LISTEN_PORT, HOST, () => console.log('Local HTTP alias: http://127.0.0.1:18993 → http://127.0.0.1:18893'));
}
