import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadBackendConfig } from '../../apps/platform/configuration/backend-config.ts';
function fixture() { const directory = mkdtempSync(join(tmpdir(), 'connet-pg-config-')), identity = join(directory, 'identity.json'), connection = join(directory, 'connection'); writeFileSync(identity, JSON.stringify({ version: 1, instanceId: 'configuration-instance', recoveryEpoch: 'configuration-epoch' }), { mode: 0o600 }); writeFileSync(connection, 'postgresql://configuration:synthetic@127.0.0.1:15432/configuration_tests\n', { mode: 0o600 }); return { directory, identity, connection, env: { M1_POSTGRES_CONNECTION_FILE: connection, M1_IDENTITY_PATH: identity } }; }
await test('PG configuration reads exact existing identity and never generates, rotates or repairs metadata', () => { const f = fixture(); try {
    const before = readFileSync(f.identity);
    const first = loadBackendConfig(f.env), second = loadBackendConfig(f.env);
    assert.equal(first.instanceId, second.instanceId);
    assert.equal(first.recoveryEpoch, second.recoveryEpoch);
    assert.equal(first.identityPath, f.identity);
    assert.deepEqual(readFileSync(f.identity), before);
    assert.throws(() => loadBackendConfig({ ...f.env, M1_RECOVERY_EPOCH: 'different-epoch' }), /conflicts/);
    assert.deepEqual(readFileSync(f.identity), before);
    writeFileSync(f.identity, 'broken metadata');
    assert.throws(() => loadBackendConfig(f.env), /refusing to regenerate/);
    assert.equal(readFileSync(f.identity, 'utf8'), 'broken metadata');
}
finally {
    rmSync(f.directory, { recursive: true, force: true });
} });
await test('PG-only startup requires one private connection and a paired identity without inventing files', () => { const f = fixture(); try {
    for (const bad of [{}, { M1_DATABASE_URL: 'postgresql://synthetic@localhost/test' }, { ...f.env, M1_DATABASE_URL: 'postgresql://synthetic@localhost/test' }, { ...f.env, M1_DATABASE_PATH: ':memory:' }, { ...f.env, M1_IDENTITY_PATH: join(f.directory, 'missing.json') }])
        assert.throws(() => loadBackendConfig(bad));
    assert.equal(existsSync(join(f.directory, 'missing.json')), false);
    chmodSync(f.connection, 0o644);
    assert.throws(() => loadBackendConfig(f.env), /private|Private/);
    chmodSync(f.connection, 0o600);
    writeFileSync(f.connection, 'sqlite:legacy');
    assert.throws(() => loadBackendConfig(f.env), /PostgreSQL/);
}
finally {
    rmSync(f.directory, { recursive: true, force: true });
} });
await test('binding, port and proxy boundaries remain explicit with PostgreSQL', () => { const f = fixture(); try {
    assert.throws(() => loadBackendConfig({ ...f.env, M1_HOST: '0.0.0.0' }), /loopback/);
    for (const M1_PORT of ['abc', '-1', '65536', '1.5', ''])
        assert.throws(() => loadBackendConfig({ ...f.env, M1_PORT }), /M1_PORT/);
    assert.equal(loadBackendConfig({ ...f.env, M1_PORT: '0' }).port, 0);
    assert.equal(loadBackendConfig(f.env).trustProxyLoopback, false);
    assert.equal(loadBackendConfig({ ...f.env, M1_TRUST_PROXY_LOOPBACK: '1' }).trustProxyLoopback, true);
    assert.equal(loadBackendConfig(f.env).worldCoreEnabled, false);
    assert.equal(loadBackendConfig({ ...f.env, WORLD_CORE_ENABLED: '1' }).worldCoreEnabled, true);
    for (const value of ['true', 'false', 'yes', '', ' 1', '2'])
        assert.throws(() => loadBackendConfig({ ...f.env, WORLD_CORE_ENABLED: value }), /WORLD_CORE_ENABLED/);
    for (const value of ['true', 'false', 'yes', '', ' 1', '2'])
        assert.throws(() => loadBackendConfig({ ...f.env, M1_TRUST_PROXY_LOOPBACK: value }), /M1_TRUST_PROXY_LOOPBACK/);
}
finally {
    rmSync(f.directory, { recursive: true, force: true });
} });
