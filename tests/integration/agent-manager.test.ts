import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/platform/app.ts';
import { openPostgresStore } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { postgresFixture } from '../api/postgresql-fixture.ts';
import { agentFixture, ownerFixture, registrationCommand, credential, operationId, injectApi, ok, type Api, type Json } from '../../scripts/agent-manager-qa-fixture.ts';
async function fixture(t: TestContext, persistent = false) {
    const pg = await postgresFixture();
    const directory = pg.directory, identity = { instanceId: pg.options.instanceId, recoveryEpoch: pg.options.recoveryEpoch };
    const options = { ...pg.options, email: { mode: 'experience' as const } };
    let app: Awaited<ReturnType<typeof buildApp>> | undefined = await buildApp(options);
    const api: Api = async (...args) => await injectApi(app!)(...args);
    const close = async () => { await app?.close(); app = undefined; };
    t.after(async () => { await close(); await pg.dispose(); });
    return { api, async restart() { await close(); app = await buildApp(options); },
        async membershipState(agentId: string, patch: Json) {
            assert.equal(persistent, true);
            await close();
            const store = await openPostgresStore(options);
            try {
                await store.transaction(async (tx) => { const row = (await tx.get('memberships', agentId))!; assert.ok(await tx.update('memberships', { ...row, version: row.version + 1, data: { ...row.data, ...patch } }, row.version)); });
            }
            finally {
                await store.close();
            }
            app = await buildApp(options);
        },
        async agentRow(agentId: string) {
            const store = await openPostgresStore(options);
            try {
                return JSON.stringify(await store.read(async (tx) => await tx.get('agents', agentId)));
            }
            finally {
                await store.close();
            }
        },
    };
}
const profile = async (api: Api, id: string, token: string) => await ok(api, 'GET', `/agents/${id}/profile`, undefined, token);
const member = async (api: Api, id: string, token: string) => await ok(api, 'GET', `/agents/${id}/membership`, undefined, token);
const publicProfile = async (api: Api, id: string) => await ok(api, 'GET', `/public/agents/${id}`);
const command = (current: Json, fields: Json, extra: Json = {}) => ({ operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion, fields, ...extra });
const save = async (api: Api, id: string, body: Json, token: string) => await ok(api, 'PUT', `/agents/${id}/profile`, body, token);
async function denied(api: Api, method: 'GET' | 'POST' | 'PUT', path: string, body: Json | undefined, token: string | undefined, status: number, code: string) {
    const result = await api(method, path, body, token);
    assert.equal(result.status, status);
    assert.equal(result.body.error?.code, code);
    return result.body.error;
}
async function policy(api: Api, owner: Json, agent: Json, mode: string, lockedFields: string[] = []) {
    const current = await profile(api, agent.agentId, owner.sessionToken);
    return await ok(api, 'PUT', `/owner/agents/${agent.agentId}/profile-policy`, { operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion, mode, lockedFields }, owner.sessionToken);
}
async function pause(api: Api, owner: Json, agent: Json, paused: boolean) {
    const current = await member(api, agent.agentId, owner.sessionToken);
    return await ok(api, 'PUT', `/owner/agents/${agent.agentId}/participation`, { operationId: operationId(), expectedVersion: current.version, paused }, owner.sessionToken);
}
const preference = (value: Json) => ({ agentId: value.agentId, version: value.version, intervalSeconds: value.intervalSeconds });
const receipt = async (api: Api, id: string, scope: string, action: string, token: string) => await ok(api, 'GET', `/operations/${id}?${new URLSearchParams({ scope, action })}`, undefined, token);
await test('registration atomically exposes a default role and concurrent retries retain one identity and exact receipt', async (t) => {
    const { api } = await fixture(t), input = registrationCommand();
    const [a, b] = await Promise.all([await ok(api, 'POST', '/registrations', input), await ok(api, 'POST', '/registrations', input)]);
    assert.deepEqual(a, b);
    const self = await ok(api, 'GET', '/agent/self', undefined, input.runtimeToken), visible = await publicProfile(api, a.agentId);
    assert.deepEqual(visible.profile, { displayName: `Agent ${a.agentId.slice(0, 8)}`, avatar: { template: 'basic', color: 'olive' } });
    assert.equal(self.profile.version, 1);
    assert.equal(self.profile.publishedVersion, 1);
    assert.equal(self.profile.policyVersion, 1);
    assert.equal(self.profile.confirmationSource, 'platform_default');
    assert.deepEqual(self.profile.draft, self.profile.published);
    assert.equal(self.membership.state, 'joined');
    assert.equal(self.membership.version, 1);
    assert.equal(self.management.managementStatus, 'pending_setup');
    assert.deepEqual(await receipt(api, input.operationId, `registration:${input.attemptId}`, 'register', input.runtimeToken), a);
    await denied(api, 'POST', '/registrations', { ...input, runtimeToken: credential() }, undefined, 409, 'idempotency_payload_mismatch');
    assert.equal((await ok(api, 'GET', `/registration-attempts/${input.attemptId}`, undefined, input.runtimeToken)).agentId, a.agentId);
});
await test('runtime and owner direct saves immediately change public fields, permit optional removal and keep no-op versions stable', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'Direct'), agent = await agentFixture(api, owner, 'Initial', 'blue');
    let current = await profile(api, agent.agentId, agent.runtimeToken);
    current = await save(api, agent.agentId, command(current, { displayName: 'Runtime current', bio: 'Public runtime value', interests: ['maps'] }), agent.runtimeToken);
    assert.equal(current.changed, true);
    assert.equal(current.saveEffect, 'public');
    assert.equal((await publicProfile(api, agent.agentId)).profile.bio, 'Public runtime value');
    current = await save(api, agent.agentId, command(current, { avatar: { template: 'basic', color: 'coral' } }, { removeFields: ['bio', 'interests'] }), owner.sessionToken);
    const visible = await publicProfile(api, agent.agentId);
    assert.equal(visible.profile.displayName, 'Runtime current');
    assert.equal(visible.profile.avatar.color, 'coral');
    assert.equal(Object.hasOwn(visible.profile, 'bio'), false);
    assert.equal(Object.hasOwn(visible.profile, 'interests'), false);
    const noOp = await save(api, agent.agentId, command(current, { displayName: 'Runtime current' }), agent.runtimeToken);
    assert.equal(noOp.changed, false);
    assert.equal(noOp.version, current.version);
    assert.equal(noOp.publishedVersion, current.publishedVersion);
    for (const fields of [{ displayName: '' }, { bio: null }])
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, fields), agent.runtimeToken, 400, 'invalid_request');
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { avatar: { template: 'external', color: 'blue' } }), agent.runtimeToken, 422, 'profile_validation_failed');
    for (const removeFields of [['displayName'], ['bio', 'bio'], ['unknown']])
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, {}, { removeFields }), owner.sessionToken, 400, 'invalid_request');
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'conflict' }, { removeFields: ['bio'] }), owner.sessionToken, 400, 'invalid_request');
    assert.deepEqual((await profile(api, agent.agentId, owner.sessionToken)).published, visible.profile);
});
await test('non-autonomous runtime remains proposal-only and an owner partial save never silently adopts or discards its draft', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'Proposal'), agent = await agentFixture(api, owner, 'Active name', 'blue');
    for (const mode of ['owner_specified', 'proposal_required']) {
        const current = await policy(api, owner, agent, mode);
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'Not authorized directly' }), agent.runtimeToken, 403, 'confirmation_required');
    }
    let current = await profile(api, agent.agentId, agent.runtimeToken);
    current = await ok(api, 'PUT', `/agents/${agent.agentId}/profile/draft`, command(current, { displayName: 'Proposed name', bio: 'PROPOSAL_NOT_YET_PUBLIC' }), agent.runtimeToken);
    assert.equal(current.proposalPending, true);
    assert.equal((await publicProfile(api, agent.agentId)).profile.displayName, 'Active name');
    const draft = current.draft;
    current = await save(api, agent.agentId, command(current, { bio: 'Owner explicitly saved this field' }), owner.sessionToken);
    assert.equal(current.published.displayName, 'Active name');
    assert.equal(current.published.bio, 'Owner explicitly saved this field');
    assert.deepEqual(current.draft, draft);
    assert.equal(current.proposalPending, true);
    assert.equal(JSON.stringify((await publicProfile(api, agent.agentId)).profile).includes('PROPOSAL_NOT_YET_PUBLIC'), false);
    current = await ok(api, 'POST', `/agents/${agent.agentId}/profile/publish`, { operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion }, owner.sessionToken);
    assert.equal(current.proposalPending, false);
    assert.equal((await publicProfile(api, agent.agentId)).profile.displayName, 'Proposed name');
});
await test('current locks, owner pause and authenticated target boundaries are enforced even for unchanged direct fields', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'Locks'), agent = await agentFixture(api, owner, 'Locked resident', 'blue');
    const otherOwner = await ownerFixture(api, 'Other'), other = await agentFixture(api, otherOwner, 'Other resident', 'cream');
    let current = await policy(api, owner, agent, 'agent_autonomous', ['bio']);
    for (const payload of [command(current, { bio: current.published.bio }), command(current, {}, { removeFields: ['bio'] })])
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, payload, agent.runtimeToken, 403, 'field_locked');
    await pause(api, owner, agent, true);
    current = await profile(api, agent.agentId, owner.sessionToken);
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { displayName: current.published.displayName }), agent.runtimeToken, 403, 'participation_paused');
    assert.equal((await profile(api, agent.agentId, agent.runtimeToken)).agentId, agent.agentId);
    current = await save(api, agent.agentId, command(current, { bio: 'Owner can still manage while paused' }), owner.sessionToken);
    for (const token of [other.runtimeToken, otherOwner.sessionToken])
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { displayName: 'Foreign overwrite' }), token, 404, 'target_not_accessible');
    assert.equal((await publicProfile(api, agent.agentId)).profile.bio, 'Owner can still manage while paused');
    assert.equal((await publicProfile(api, other.agentId)).profile.displayName, 'Other resident');
});
await test('discarded direct-save responses resume the original receipt while profile and policy conflicts cannot overwrite either Agent', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'Receipt'), agent = await agentFixture(api, owner, 'Receipt A', 'blue'), other = await agentFixture(api, owner, 'Receipt B', 'coral');
    const before = await profile(api, agent.agentId, owner.sessionToken), input = command(before, { bio: 'Committed before response was discarded' });
    await ok(api, 'PUT', `/agents/${agent.agentId}/profile`, input, owner.sessionToken); // Caller discards the response; the server really committed.
    const original = await receipt(api, input.operationId, `owner:${owner.ownerId}`, 'saveProfile', owner.sessionToken);
    assert.equal(original.agentId, agent.agentId);
    assert.equal(original.saveEffect, 'public');
    assert.equal(original.published.bio, input.fields.bio);
    assert.deepEqual(await save(api, agent.agentId, input, owner.sessionToken), original);
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, { ...input, fields: { bio: 'Changed retry' } }, owner.sessionToken, 409, 'idempotency_payload_mismatch');
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(before, { displayName: 'Stale overwrite' }), owner.sessionToken, 409, 'version_conflict');
    const policyAfter = await policy(api, owner, agent, 'agent_autonomous', []);
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, { ...command(policyAfter, { displayName: 'Stale policy' }), expectedPolicyVersion: before.policyVersion }, owner.sessionToken, 409, 'version_conflict');
    assert.equal((await publicProfile(api, agent.agentId)).profile.bio, input.fields.bio);
    assert.equal((await publicProfile(api, other.agentId)).profile.displayName, 'Receipt B');
});
await test('world access starts unset, saves exact seconds privately, supports clear and rejects runtime, foreign, invalid and stale writes', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'Access'), agent = await agentFixture(api, owner, 'Access A', 'blue'), sibling = await agentFixture(api, owner, 'Access B', 'coral');
    const other = await ownerFixture(api, 'Foreign');
    const path = `/agents/${agent.agentId}/world-access`, writePath = `/owner/agents/${agent.agentId}/world-access`;
    assert.deepEqual(preference(await ok(api, 'GET', path, undefined, agent.runtimeToken)), { agentId: agent.agentId, version: 1, intervalSeconds: null });
    const input = { operationId: operationId(), expectedVersion: 1, intervalSeconds: 900 };
    const saved = await ok(api, 'PUT', writePath, input, owner.sessionToken);
    assert.equal(saved.changed, true);
    assert.equal(saved.version, 2);
    assert.deepEqual(await ok(api, 'PUT', writePath, input, owner.sessionToken), saved);
    assert.deepEqual(await receipt(api, input.operationId, `owner:${owner.ownerId}`, 'saveWorldAccess', owner.sessionToken), saved);
    const noOp = await ok(api, 'PUT', writePath, { ...input, operationId: operationId(), expectedVersion: 2 }, owner.sessionToken);
    assert.equal(noOp.changed, false);
    assert.equal(noOp.version, 2);
    await denied(api, 'PUT', writePath, { ...input, operationId: operationId() }, owner.sessionToken, 409, 'version_conflict');
    for (const intervalSeconds of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '900'])
        await denied(api, 'PUT', writePath, { operationId: operationId(), expectedVersion: 2, intervalSeconds }, owner.sessionToken, 400, 'invalid_request');
    await denied(api, 'PUT', writePath, { operationId: operationId(), expectedVersion: 2, intervalSeconds: 60 }, agent.runtimeToken, 403, 'insufficient_scope');
    for (const token of [sibling.runtimeToken, other.sessionToken])
        await denied(api, 'GET', path, undefined, token, 404, 'target_not_accessible');
    await denied(api, 'PUT', writePath, { operationId: operationId(), expectedVersion: 2, intervalSeconds: 60 }, other.sessionToken, 404, 'target_not_accessible');
    const self = await ok(api, 'GET', '/agent/self', undefined, agent.runtimeToken), list = await ok(api, 'GET', '/owner/agents', undefined, owner.sessionToken);
    assert.equal(self.worldAccess.intervalSeconds, 900);
    assert.equal(list.agents.find((row: Json) => row.agentId === agent.agentId).worldAccess.intervalSeconds, 900);
    assert.equal(self.effectiveActions.saveWorldAccess.allowed, false);
    assert.equal(self.effectiveActions.readWorldAccess.allowed, true);
    const visible = await publicProfile(api, agent.agentId), publicText = JSON.stringify(visible);
    for (const secret of [owner.ownerId, owner.email, owner.sessionToken, agent.runtimeToken, 'intervalSeconds', 'worldAccess'])
        assert.equal(publicText.includes(secret), false, 'Public view excludes private settings and credentials');
    const cleared = await ok(api, 'PUT', writePath, { operationId: operationId(), expectedVersion: 2, intervalSeconds: null }, owner.sessionToken);
    assert.deepEqual(preference(cleared), { agentId: agent.agentId, version: 3, intervalSeconds: null });
    assert.equal((await ok(api, 'GET', `/agents/${sibling.agentId}/world-access`, undefined, sibling.runtimeToken)).version, 1);
    const caps = await ok(api, 'GET', '/capabilities');
    assert.equal(caps.scheduling, false);
    assert.equal(caps.profileSave, 'immediate-public');
});
await test('private settings survive close/reopen without read-time backfill and platform or historical restrictions remain real server checks', async (t) => {
    const f = await fixture(t, true), { api } = f, owner = await ownerFixture(api, 'Restart'), agent = await agentFixture(api, owner, 'Persistent', 'blue');
    const rowBefore = await f.agentRow(agent.agentId);
    await ok(api, 'GET', `/agents/${agent.agentId}/world-access`, undefined, agent.runtimeToken);
    assert.equal(await f.agentRow(agent.agentId), rowBefore, 'Reading unset does not backfill an existing Agent row');
    await ok(api, 'PUT', `/owner/agents/${agent.agentId}/world-access`, { operationId: operationId(), expectedVersion: 1, intervalSeconds: 3600 }, owner.sessionToken);
    await f.restart();
    assert.equal((await ok(api, 'GET', '/agent/self', undefined, agent.runtimeToken)).worldAccess.intervalSeconds, 3600);
    let current = await profile(api, agent.agentId, owner.sessionToken);
    await save(api, agent.agentId, command(current, { bio: 'Unrelated profile write' }), owner.sessionToken);
    await f.restart();
    assert.equal((await ok(api, 'GET', `/agents/${agent.agentId}/world-access`, undefined, owner.sessionToken)).intervalSeconds, 3600);
    // Only these isolated negative fixtures use storage controls; QA generation never does.
    await f.membershipState(agent.agentId, { platformRestricted: true });
    current = await profile(api, agent.agentId, owner.sessionToken);
    for (const token of [owner.sessionToken, agent.runtimeToken])
        await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'Forbidden' }), token, 403, 'platform_restricted');
    await denied(api, 'PUT', `/owner/agents/${agent.agentId}/world-access`, { operationId: operationId(), expectedVersion: 2, intervalSeconds: 60 }, owner.sessionToken, 403, 'platform_restricted');
    await denied(api, 'GET', `/public/agents/${agent.agentId}`, undefined, undefined, 404, 'target_not_accessible');
    await f.membershipState(agent.agentId, { platformRestricted: false, state: 'not_joined' });
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'No implicit join' }), owner.sessionToken, 409, 'role_not_public');
    assert.equal((await member(api, agent.agentId, owner.sessionToken)).state, 'not_joined');
});
await test('historical left or unpublished roles require explicit recovery and never silently adopt an old proposal', async (t) => {
    const { api } = await fixture(t), owner = await ownerFixture(api, 'History'), agent = await agentFixture(api, owner, 'Old draft name', 'coral');
    let current = await profile(api, agent.agentId, owner.sessionToken), membership = await member(api, agent.agentId, agent.runtimeToken);
    membership = await ok(api, 'POST', `/agents/${agent.agentId}/membership/leave`, { operationId: operationId(), expectedVersion: membership.version }, agent.runtimeToken);
    const blocked = await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'No implicit rejoin' }), owner.sessionToken, 409, 'role_not_public');
    assert.deepEqual(blocked.details, { membershipState: 'left', published: true });
    await ok(api, 'POST', `/agents/${agent.agentId}/membership/join`, { operationId: operationId(), expectedVersion: membership.version, expectedProfileVersion: current.version }, owner.sessionToken);
    current = await ok(api, 'POST', `/agents/${agent.agentId}/profile/unpublish`, { operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion }, owner.sessionToken);
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'Runtime cannot restore publication' }), agent.runtimeToken, 409, 'role_not_public');
    const oldDraft = current.draft;
    current = await save(api, agent.agentId, command(current, { bio: 'Explicit owner recovery' }), owner.sessionToken);
    assert.equal(current.published.displayName, `Agent ${agent.agentId.slice(0, 8)}`);
    assert.equal(current.published.avatar.color, 'olive');
    assert.deepEqual(current.draft, oldDraft);
    assert.equal((await publicProfile(api, agent.agentId)).profile.bio, 'Explicit owner recovery');
    membership = await member(api, agent.agentId, owner.sessionToken);
    membership = await ok(api, 'POST', `/agents/${agent.agentId}/membership/leave`, { operationId: operationId(), expectedVersion: membership.version }, owner.sessionToken);
    current = await ok(api, 'POST', `/agents/${agent.agentId}/profile/unpublish`, { operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion }, owner.sessionToken);
    await denied(api, 'PUT', `/agents/${agent.agentId}/profile`, command(current, { bio: 'Still not joined' }), owner.sessionToken, 409, 'role_not_public');
    current = await ok(api, 'PUT', `/agents/${agent.agentId}/profile/draft`, command(current, { displayName: 'Reviewed recovery', avatar: { template: 'basic', color: 'blue' }, bio: 'Explicitly reviewed' }), owner.sessionToken);
    current = await ok(api, 'POST', `/agents/${agent.agentId}/profile/publish`, { operationId: operationId(), expectedVersion: current.version, expectedPolicyVersion: current.policyVersion }, owner.sessionToken);
    await ok(api, 'POST', `/agents/${agent.agentId}/membership/join`, { operationId: operationId(), expectedVersion: membership.version, expectedProfileVersion: current.version }, owner.sessionToken);
    assert.equal((await publicProfile(api, agent.agentId)).profile.displayName, 'Reviewed recovery');
});
