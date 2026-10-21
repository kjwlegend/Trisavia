import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import type { AgentGateway } from '../../apps/platform/application/agent-gateway.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { StorageError } from '../../apps/platform/contracts/store.ts';
import { registerAgentGatewayRoutes } from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import { registerWorldObservationRoutes } from '../../apps/platform/transport/http/agent-gateway-world-routes.ts';

// Real HTTP transport and World public adapter, with a local clock and no DB,
// external service, running user server or business-authentication substitution.
async function fixture(t: TestContext) {
    let now = 1_790_000_000_000;
    t.mock.method(Date, 'now', () => now);
    const handled: string[] = [];
    let failure: unknown;
    const gateway = {
        discovery() { handled.push('discovery'); return {}; },
        schema() { handled.push('schema'); return {}; },
        guide() { handled.push('guide'); return {}; },
        async publicRead(operation: string) { handled.push(operation); if (failure) throw failure; return { avatars: [], complete: true }; },
        async query() { handled.push('query'); return {}; },
        async command() { handled.push('command'); return {}; },
        async receipt() { handled.push('receipt'); return {}; },
    } as unknown as AgentGateway;
    const app = Fastify({ logger: false });
    registerWorldObservationRoutes(gateway, registerAgentGatewayRoutes(app, gateway, { instanceId: 'instance_isolated_rate_limit', now: () => now }));
    t.after(async () => { await app.close(); });
    const request = (url = '/v1/world/scene?worldId=default', remoteAddress = '127.0.0.1') => app.inject({ method: 'GET', url, remoteAddress });
    return { app, handled, request, advance(ms: number) { now += ms; }, failWith(error: unknown) { failure = error; } };
}

const discoveryReads = ['/v1/gateway/discovery', '/v1/gateway/schemas/world.public_scene.input?version=1', '/v1/gateway/schemas/world.public_scene.output?version=1', '/v1/gateway/schemas/world.public_rules.input?version=1', '/v1/gateway/schemas/world.public_rules.output?version=1', '/v1/gateway/guides/world?version=1'];

await test('two natural one-second World pages plus normal exact-document discovery hit the shared cap and expose the remaining retry delay', async (t) => {
    const f = await fixture(t), rejected = [];
    for (const url of discoveryReads) assert.equal((await f.request(url)).statusCode, 200);
    // 59 cycles/minute accounts for a small request/response delay, rather than
    // assuming the page can poll instantaneously at an exact 60 cycles/minute.
    for (let tick = 0; tick < 59; tick++) {
        if (tick) f.advance(1010);
        for (let tab = 0; tab < 2; tab++) for (const path of ['rules', 'scene']) {
            const response = await f.request(`/v1/world/${path}?worldId=default`);
            if (response.statusCode === 429) rejected.push(response);
            else assert.equal(response.statusCode, 200);
        }
    }
    assert.equal(f.handled.length, 240);
    assert.equal(rejected.length, 2);
    console.info(JSON.stringify({ isolatedRateModel: { visibleTabs: 2, cyclesPerTab: 59, metadataRequests: 6, worldRequests: 236, accepted: 240, rejected: 2, remainingWindowMs: 1420 } }));
    for (const response of rejected) {
        assert.equal(response.json().error.code, 'rate_limited');
        assert.equal(response.headers['retry-after'], '2');
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(Object.keys(response.json().error).sort(), ['code', 'message'], 'The error body contract remains unchanged');
    }
});

await test('one page and normal discovery fit the existing cap without extra backoff metadata', async (t) => {
    const f = await fixture(t);
    for (const url of discoveryReads) assert.equal((await f.request(url)).statusCode, 200);
    for (let tick = 0; tick < 59; tick++) {
        if (tick) f.advance(1010);
        for (const path of ['rules', 'scene']) {
            const response = await f.request(`/v1/world/${path}?worldId=default`);
            assert.equal(response.statusCode, 200);
            assert.equal(response.headers['retry-after'], undefined);
        }
    }
    assert.equal(f.handled.length, 124);
});

await test('Retry-After uses whole remaining seconds with a one-second floor; the exact window boundary, per-IP scope and authentication guard are retained', async (t) => {
    const f = await fixture(t);
    for (let n = 0; n < 239; n++) assert.equal((await f.request()).statusCode, 200);
    const unauthenticated = await f.app.inject({ method: 'POST', url: '/v1/gateway/commands', payload: {} });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.json().error.code, 'authentication_failed');
    assert.equal(f.handled.includes('command'), false);
    const full = await f.request();
    assert.equal(full.statusCode, 429);
    assert.equal(full.headers['retry-after'], '60');
    assert.equal((await f.request(undefined, '192.0.2.1')).statusCode, 200, 'Another IP has its own unchanged quota');
    f.advance(12_001);
    assert.equal((await f.request()).headers['retry-after'], '48', 'Use ceiling, never an early retry at the fractional boundary');
    f.advance(47_998);
    const almost = await f.request();
    assert.equal(almost.statusCode, 429);
    assert.equal(almost.headers['retry-after'], '1');
    const blockedWrite = await f.app.inject({ method: 'POST', url: '/v1/gateway/commands', headers: { authorization: 'Bearer isolated-test-only' }, payload: {} });
    assert.equal(blockedWrite.statusCode, 429);
    assert.equal(f.handled.includes('command'), false, 'A saturated IP cannot bypass quota through a command route');
    f.advance(1);
    const reset = await f.request();
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.headers['retry-after'], undefined);
    const stillUnauthenticated = await f.app.inject({ method: 'POST', url: '/v1/gateway/commands', payload: {} });
    assert.equal(stillUnauthenticated.statusCode, 401);
    assert.equal(f.handled.includes('command'), false);
});

await test('a full IP-window map gives conservative Retry-After 60 and retains existing-client capacity and bounded cleanup', async (t) => {
    const f = await fixture(t);
    for (let n = 0; n < 10_000; n++) {
        const remoteAddress = `10.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
        assert.equal((await f.request('/v1/gateway/discovery', remoteAddress)).statusCode, 200);
    }
    const full = await f.request('/v1/gateway/discovery', '192.0.2.2');
    assert.equal(full.statusCode, 429);
    assert.equal(full.json().error.code, 'rate_limited');
    assert.equal(full.headers['retry-after'], '60');
    assert.equal(full.headers['cache-control'], 'no-store');
    assert.equal((await f.request('/v1/gateway/discovery', '10.0.0.1')).statusCode, 200);
    f.advance(60_000);
    const afterCleanup = await f.request('/v1/gateway/discovery', '192.0.2.2');
    assert.equal(afterCleanup.statusCode, 200);
    assert.equal(afterCleanup.headers['retry-after'], undefined);
});

await test('the transport does not invent retry deadlines for domain denial, unready World or unrelated transient failures', async (t) => {
    const f = await fixture(t);
    for (const [error, status, code] of [
        [new M1Error('world_not_accessible', 404, 'Unavailable World'), 404, 'world_not_accessible'],
        [new M1Error('world_not_available', 503, 'Unready World'), 503, 'world_not_available'],
        [new M1Error('insufficient_scope', 403, 'No permission'), 403, 'insufficient_scope'],
        [new StorageError('busy', 'Temporary local fixture contention'), 503, 'busy'],
        [new M1Error('rate_limited', 429, 'Another component owns this limit'), 429, 'rate_limited'],
    ] as const) {
        f.failWith(error);
        const response = await f.request();
        assert.equal(response.statusCode, status);
        assert.equal(response.json().error.code, code);
        assert.equal(response.headers['retry-after'], undefined);
    }
});
