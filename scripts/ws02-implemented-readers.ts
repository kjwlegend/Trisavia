import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { administrativeTarget } from './ws02-admin-target.ts';
import { publishImplementedPerceptionReaders } from '../apps/platform/application/perception-admin.ts';

/** Explicit paired PG maintenance command; no migration, seed, object grant or HTTP authority. */
export async function runImplementedReaders(args: string[]) {
    const selected = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
    const expectedCatalogRevision = selected('--expected-catalog-revision'), revision = selected('--revision'), version = selected('--guide-version'), operationId = selected('--operation-id');
    const expectedInstanceId = selected('--expected-instance'), expectedRecoveryEpoch = selected('--expected-epoch');
    if (!expectedInstanceId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedInstanceId) || !expectedRecoveryEpoch || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedRecoveryEpoch) || !expectedCatalogRevision || !/^[A-Za-z0-9_-]{1,100}$/.test(expectedCatalogRevision) || !revision || !/^[A-Za-z0-9_-]{1,100}$/.test(revision) || !version || !/^[1-9][0-9]{0,8}$/.test(version) || !operationId || !/^.{8,100}$/u.test(operationId))
        throw new Error('Explicit expected and target catalog revisions, guide version and operation ID are required');
    const { values, manifestPath, store } = await administrativeTarget(args, ['--expected-instance', '--expected-epoch', '--expected-catalog-revision', '--revision', '--guide-version', '--operation-id']);
    try {
        const receipt = await publishImplementedPerceptionReaders(store, { actorId: values['--operator']!, operationId, expectedInstanceId, expectedRecoveryEpoch, expectedCatalogRevision, revision, guideVersion: Number(version) });
        await writeFile(manifestPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { status: 'committed', instanceId: store.instanceId, receipt, manifestPath };
    } finally { await store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    runImplementedReaders(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('ws02_reader_publication_failed; retain the target and recover using the original operation ID.\n'); process.exitCode = 1; });
