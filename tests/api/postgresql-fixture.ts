import { grantApplicationPermissions } from '../../scripts/postgresql/permissions.ts';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createIsolatedDatabase, dropIsolatedDatabase } from '../../scripts/postgresql/database.ts';
import { readRuntime } from '../../scripts/postgresql/runtime.ts';
import { migratePostgres, POSTGRES_MIGRATIONS } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { openPostgresStore } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { bootstrapPlatformCatalog } from '../../apps/platform/application/bootstrap.ts';
/** Each application fixture owns a fresh real PostgreSQL database, private connection files and identity. */
export async function postgresFixture(identity = { instanceId: `instance_${randomUUID()}`, recoveryEpoch: `epoch_${randomUUID()}` }, setup: { bootstrap?: boolean } = {}) {
    const runtimeFile = process.env.M1_POSTGRES_TEST_RUNTIME;
    if (!runtimeFile)
        throw new Error('Explicit isolated PostgreSQL test runtime is required');
    const runtime = await readRuntime(runtimeFile), directory = await mkdtemp(join(tmpdir(), 'connet-pg-application-'));
    let connections: string | undefined, store: Awaited<ReturnType<typeof openPostgresStore>> | undefined, disposed = false;
    const dispose=async()=>{if(disposed)return;try{if(store)await originalClose!();if(connections)await dropIsolatedDatabase(runtime,connections);disposed=true;await rm(directory,{recursive:true,force:true});}catch(error){throw error;}};
    let originalClose: (() => Promise<void>) | undefined;
    try {
        const made = await createIsolatedDatabase(runtime, `connet_application_${randomUUID().replaceAll('-', '')}`, join(directory, 'connections'));
        connections = made.privateConnections;
        const migrationConnectionString = (await readFile(join(connections, 'migration-database-url'), 'utf8')).trim(), connectionString = (await readFile(join(connections, 'application-database-url'), 'utf8')).trim();
        await migratePostgres({ connectionString: migrationConnectionString, ...identity });
        await grantApplicationPermissions(runtime,made.database);
        const ddl=new Pool({connectionString:migrationConnectionString,max:1});
        try{await ddl.query('UPDATE platform.instance_state SET writes_enabled=true WHERE singleton=1');}finally{await ddl.end();}
        const options = { connectionString, ...identity };
        store = await openPostgresStore(options);
        originalClose = store.close.bind(store);
        store.close = dispose;
        if (setup.bootstrap !== false) await bootstrapPlatformCatalog(store);
        const identityPath = join(directory, 'identity.json');
        await writeFile(identityPath, JSON.stringify({ version: 1, ...identity }) + '\n', { mode: 0o600, flag: 'wx' });
        return { directory, privateConnections: connections, identityPath, options, store, dispose, migrationConnectionString,
            sql:async(statement:string,values:unknown[]=[])=>{const pool=new Pool({connectionString:migrationConnectionString,max:1});try{return (await pool.query(statement,values)).rows;}finally{await pool.end();}},
        };
    }
    catch (error) {
        await dispose();
        throw error;
    }
}
// Legacy test labels address private PostgreSQL targets only; they never open a SQLite file.
const testTargets = new Map<string, Awaited<ReturnType<typeof postgresFixture>>>();
export async function testStoreOptions(label: string) {
    const fixture = testTargets.get(label);
    if (!fixture)
        throw new Error('The named isolated test target has not been created');
    return fixture.options;
}
export async function openTestStore(options: {
    databasePath?: string;
    instanceId: string;
    recoveryEpoch: string;
}) {
    const label = options.databasePath ?? ':memory:';
    if (label === ':memory:')
        return (await postgresFixture({ instanceId: options.instanceId, recoveryEpoch: options.recoveryEpoch })).store;
    let fixture = testTargets.get(label);
    if (!fixture) {
        fixture = await postgresFixture({ instanceId: options.instanceId, recoveryEpoch: options.recoveryEpoch });
        testTargets.set(label, fixture);
    }
    return await openPostgresStore({ ...fixture.options, instanceId: options.instanceId, recoveryEpoch: options.recoveryEpoch });
}
import { after } from 'node:test';
after(async () => {
    for (const fixture of testTargets.values())
        await fixture.dispose();
    testTargets.clear();
});
import { buildApp, type BuildAppOptions } from '../../apps/platform/app.ts';
/** Test-only convenience; runtime buildApp still requires an explicit existing PG target. */
export async function testApplication(options: Partial<BuildAppOptions> = {}) {
    if (options.connectionString && options.instanceId && options.recoveryEpoch)
        return await buildApp(options as BuildAppOptions);
    const pg=await postgresFixture({instanceId:options.instanceId??`instance_${randomUUID()}`,recoveryEpoch:options.recoveryEpoch??`epoch_${randomUUID()}`});
    try {
        const app = await buildApp({ ...pg.options, ...options });
        const close=app.close.bind(app);app.close=(async()=>{try{await close();}finally{await pg.dispose();}}) as typeof app.close;
        return app;
    }
    catch (error) {
        await pg.dispose();
        throw error;
    }
}
