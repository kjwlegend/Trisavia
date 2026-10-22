import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionRepository } from '../../apps/platform/infrastructure/postgresql/interaction-repository.ts';
import type { RuntimeSql } from '../../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import { makeInvitation } from '../../apps/platform/domains/interaction/transitions.ts';
import { TEXT_FEEDBACK_V1, type ArtifactRevision } from '../../apps/platform/domains/interaction/types.ts';
import { coreFixture } from '../world/runtime-fixture.ts';

const artifact = (artifactId: string, authorAgentId: string, revision = 1, withdrawnAt: number | null = null): ArtifactRevision => ({
  artifactId, revision, authorAgentId, version: 1, title: 'Synthetic work', body: 'SYNTHETIC_PRIVATE_BODY', createdAt: 1000, withdrawnAt
});

test('author source pages include unsent and withdrawn own revisions, exclude other authors, and resume within an artifact', async () => {
  const f = coreFixture();
  for (const value of [artifact('work-z', 'author-a'), artifact('work-a', 'author-a', 2), artifact('other-first', 'author-b'), artifact('work-a', 'author-a'), artifact('work-withdrawn', 'author-a', 1, 2000)]) await f.interaction.saveArtifact(value, null);
  const first = await f.interaction.listArtifacts('author-a', { limit: 1 });
  assert.deepEqual(first.map(value => [value.artifactId, value.revision]), [['work-a', 1]]);
  const second = await f.interaction.listArtifacts('author-a', { after: first[0]!, limit: 2 });
  assert.deepEqual(second.map(value => [value.artifactId, value.revision]), [['work-a', 2], ['work-withdrawn', 1]]);
  assert.equal(second[1]!.withdrawnAt, 2000);
  assert.deepEqual((await f.interaction.listArtifacts('author-a', { after: second[1]!, limit: 2 })).map(value => value.artifactId), ['work-z']);
  assert.deepEqual(await f.interaction.listArtifacts('not-an-author', { limit: 100 }), []);
  assert.equal(f.state.invitations.size, 0, 'Unsent works must not require an invitation to appear');
});

test('artifact-filtered invitations retain the participant restriction and enumerate multiple recipients without mixing revisions', async () => {
  const f = coreFixture(), own = artifact('own-work', 'author-a'), otherRevision = artifact('own-work', 'author-a', 2), incoming = artifact('incoming-work', 'author-b');
  for (const [id, from, to, work] of [
    ['invite-z', 'author-a', 'author-b', own], ['invite-a', 'author-a', 'author-c', own],
    ['invite-r2', 'author-a', 'author-b', otherRevision], ['invite-incoming', 'author-b', 'author-a', incoming],
    ['invite-unrelated', 'author-b', 'author-c', incoming]
  ] as const) {
    const value = makeInvitation({ id, worldId: 'default', actorId: from, recipientId: to, artifact: work, intent: 'Synthetic source test', configuration: { ...TEXT_FEEDBACK_V1 }, sharedGeneration: 0, participantGenerations: { from: 1, to: 1 }, now: f.now });
    await f.interaction.saveInvitation(value, null);
  }
  const first = await f.interaction.listInvitations('author-a', { artifact: own, limit: 1 });
  assert.deepEqual(first.map(value => value.id), ['invite-a']);
  const next = await f.interaction.listInvitations('author-a', { artifact: own, afterId: first[0]!.id, limit: 1 });
  assert.deepEqual(next.map(value => value.toAgentId), ['author-b']);
  assert.deepEqual(await f.interaction.listInvitations('nonparticipant', { artifact: own, limit: 100 }), []);
  assert.deepEqual((await f.interaction.listInvitations('author-a', { artifact: otherRevision, limit: 100 })).map(value => value.id), ['invite-r2']);
  assert.deepEqual((await f.interaction.listInvitations('author-a', { artifact: incoming, limit: 100 })).map(value => value.id), ['invite-incoming']);
  assert.deepEqual((await f.interaction.listInvitations('author-a', { limit: 100 })).map(value => value.id), ['invite-a', 'invite-incoming', 'invite-r2', 'invite-z']);
});

function sqlReadProbe() {
  const calls: { statement: string; values: unknown[] }[] = [];
  const sql = {
    async query(statement: string, values: unknown[] = []) { calls.push({ statement, values }); return []; },
    writable() { throw new Error('Source query attempted a write'); },
    async mutate() { throw new Error('Source query attempted a write'); }
  } as unknown as RuntimeSql;
  return { calls, reader: createInteractionRepository(sql).reader };
}

test('PostgreSQL source adapters bind author/participant, full artifact reference, stable cursor and bounded page size in SELECT only', async () => {
  const { calls, reader } = sqlReadProbe(), dangerousId = "author-' OR true --";
  await reader.listArtifacts(dangerousId, { limit: 7, after: { artifactId: 'work-cursor', revision: 2 } });
  const works = calls[0]!;
  assert.match(works.statement, /WHERE author_agent_id=\$1 AND/);
  assert.match(works.statement, /artifact_id>\$2 COLLATE "C" OR \(artifact_id=\$2 AND revision>\$3\)/);
  assert.match(works.statement, /ORDER BY artifact_id COLLATE "C",revision LIMIT \$4$/);
  assert.equal(works.statement.includes(dangerousId), false);
  assert.deepEqual(works.values, [dangerousId, 'work-cursor', 2, 7]);
  await reader.listInvitations(dangerousId, { limit: 9, afterId: 'invite-cursor', artifact: { artifactId: 'own-work', revision: 3 } });
  const invitations = calls[1]!;
  assert.match(invitations.statement, /WHERE \(from_agent_id=\$1 OR to_agent_id=\$1\) AND/);
  assert.match(invitations.statement, /AND \(\$4::text IS NULL OR \(artifact_id=\$4 AND artifact_revision=\$5\)\)/);
  assert.deepEqual(invitations.values, [dangerousId, 'invite-cursor', 9, 'own-work', 3]);
  await reader.listArtifacts('author-a', { limit: 1 }); assert.deepEqual(calls[2]!.values, ['author-a', null, null, 1]);
  await reader.listInvitations('author-a', { limit: 1 }); assert.deepEqual(calls[3]!.values, ['author-a', null, 1, null, null]);
});

test('source query bounds and malformed cursor/reference fail before SQL execution', async () => {
  const { calls, reader } = sqlReadProbe();
  for (const limit of [0, 101, 1.5, NaN]) {
    await assert.rejects(reader.listArtifacts('author-a', { limit }), { code: 'invalid_usage' });
    await assert.rejects(reader.listInvitations('author-a', { limit }), { code: 'invalid_usage' });
  }
  await assert.rejects(reader.listArtifacts('', { limit: 1 }), { code: 'invalid_usage' });
  await assert.rejects(reader.listArtifacts('author-a', { after: { artifactId: 'work', revision: 0 }, limit: 1 }), { code: 'invalid_usage' });
  await assert.rejects(reader.listInvitations('author-a', { artifact: { artifactId: 'work', revision: 0 }, limit: 1 }), { code: 'invalid_usage' });
  assert.equal(calls.length, 0);
});
