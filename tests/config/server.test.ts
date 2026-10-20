import { postgresFixture } from '../api/postgresql-fixture.ts';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const entry = fileURLToPath(new URL('../../apps/platform/server.ts', import.meta.url));
async function launch(pg:Awaited<ReturnType<typeof postgresFixture>>, trustProxyLoopback = false): Promise<{
    child: ChildProcessWithoutNullStreams;
    address: string;
}> {
    const child = spawn(process.execPath, [entry], {
        cwd: pg.directory,
        env: {
            ...process.env, M1_HOST: '127.0.0.1', M1_PORT: '0',
            M1_TRUST_PROXY_LOOPBACK: trustProxyLoopback ? '1' : '0',
            M1_POSTGRES_CONNECTION_FILE: join(pg.privateConnections, 'application-database-url'),
            M1_IDENTITY_PATH: pg.identityPath,
            M1_INSTANCE_ID: pg.options.instanceId, M1_RECOVERY_EPOCH: pg.options.recoveryEpoch,
        },
        stdio: 'pipe',
    });
    try {
        const address = await new Promise<string>((resolve, reject) => {
            let stdout = '';
            const timer = setTimeout(() => { cleanup(); reject(new Error('CLI startup timed out')); }, 8000);
            const onData = (chunk: Buffer) => {
                stdout += chunk.toString();
                const match = /M1 backend listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
                if (match) {
                    cleanup();
                    resolve(match[1]!);
                }
            };
            const onExit = () => { cleanup(); reject(new Error('CLI exited before readiness')); };
            const onError = () => { cleanup(); reject(new Error('CLI could not start')); };
            const cleanup = () => {
                clearTimeout(timer);
                child.stdout.off('data', onData);
                child.off('exit', onExit);
                child.off('error', onError);
            };
            child.stdout.on('data', onData);
            child.once('exit', onExit);
            child.once('error', onError);
        });
        return { child, address };
    }
    catch (error) {
        await stop(child);
        throw error;
    }
}
async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
    });
}
await test('CLI serves real loopback HTTP, shuts down and reopens the same local database', { timeout: 20000 }, async () => {
    const pg=await postgresFixture({instanceId:'smoke-instance',recoveryEpoch:'smoke-epoch'});
    let active: ChildProcessWithoutNullStreams | undefined;
    try {
        for (let run = 0; run < 2; run++) {
            const started = await launch(pg);
            active = started.child;
            const response = await fetch(`${started.address}/health`, { signal: AbortSignal.timeout(3000) });
            assert.equal(response.status, 200);
            assert.equal((await response.json() as {
                instanceId: string;
            }).instanceId, 'smoke-instance');
            const capabilities = await fetch(`${started.address}/v1/capabilities`, { signal: AbortSignal.timeout(3000) });
            assert.equal(capabilities.status, 200);
            assert.equal((await capabilities.json() as {
                scheduling: boolean;
            }).scheduling, false);
            await stop(active);
            assert.equal(active.exitCode, 0);
            active = undefined;
        }
    }
    finally {
        if (active)
            await stop(active);
        await pg.dispose();
    }
});
await test('CLI passes explicit proxy opt-in to real loopback HTTP client quotas', { timeout: 20000 }, async () => {
    const pg=await postgresFixture();
    let active: ChildProcessWithoutNullStreams | undefined;
    try {
        const started = await launch(pg, true);
        active = started.child;
        const status = async (forwarded: string) => {
            const response = await fetch(`${started.address}/v1/capabilities`, {
                headers: { 'x-forwarded-for': forwarded }, signal: AbortSignal.timeout(3000),
            });
            await response.arrayBuffer();
            return response.status;
        };
        for (let count = 0; count < 240; count++)
            assert.equal(await status(`203.0.113.${count % 250 + 1}, 198.51.100.10`), 200);
        assert.equal(await status('192.0.2.99, 198.51.100.10'), 429);
        assert.equal(await status('192.0.2.99, 198.51.100.20'), 200);
    }
    finally {
        if (active)
            await stop(active);
        await pg.dispose();
    }
});
