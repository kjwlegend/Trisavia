import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject } from '../../apps/platform/contracts/store.ts';
import type { Principal } from '../../apps/platform/domains/access/public.ts';
import { M1Error } from '../../apps/platform/domains/common/errors.ts';
import { bootstrapInteraction, createInteractionService } from '../../apps/platform/application/interaction-service.ts';
import { coreFixture } from '../world/runtime-fixture.ts';

async function fixture() {
  const f = coreFixture(), a = f.addAgent('agent-a'), b = f.addAgent('agent-b'), c = f.addAgent('agent-c');
  const service = createInteractionService(f.identity, f.decisions);
  await f.store.transaction(ctx => bootstrapInteraction(ctx));
  const command = (principal: Principal, action: string, input: JsonObject) => f.store.transaction(ctx => service.execute(ctx, principal, f.key(principal, action), input));
  async function invite(from: Principal, label: string) {
    const artifact = await command(from, 'interaction.artifact.create', { body: label });
    const result = await command(from, 'interaction.invitation.send', { worldId: 'default', toAgentId: 'agent-b', artifact: artifact.result.artifact!, expectedArtifactVersion: 1,
      templateVersion: 1, configVersion: 1, intent: '仅授权双方查看' });
    assert.equal(result.outcome, 'committed');
    return { artifact, invitation: f.state.invitations.get(result.result.invitationId as string)! };
  }
  return { f, a, b, c, service, command, invite };
}

test('WC-CR03: withdrawn or blocked sole invitation never escapes through an empty current-items page', async () => {
  for (const mode of ['withdraw', 'block']) {
    const { f, a, b, service, command, invite } = await fixture(), hidden = await invite(a, '撤权后不再披露的正文');
    if (mode === 'withdraw') await command(a, 'interaction.artifact.withdraw', { artifact: hidden.artifact.result.artifact!, expectedVersion: 1 });
    else await command(a, 'interaction.policy.block', { agentId: 'agent-b', expectedVersion: 1 });
    const page = await service.listCurrent(f.context, b, { limit: 1 });
    assert.deepEqual(page.items, []); assert.equal(page.complete, true); assert.equal(page.nextCursor, null);
    assert.equal('nextAfterId' in page, false); assert.equal(JSON.stringify(page).includes(hidden.invitation.id), false);
  }
});

test('WC-CR03: hidden page tails and an entirely hidden bounded batch still advance to authorized invitations', async () => {
  for (const mode of ['withdraw', 'block']) {
    const { f, a, b, c, service, command, invite } = await fixture(), hidden = await invite(a, '已撤共享'), visible = await invite(c, '仍获准共享');
    await command(b, 'interaction.invitation.decline', { invitationId: hidden.invitation.id, expectedVersion: 1 });
    await command(b, 'interaction.invitation.decline', { invitationId: visible.invitation.id, expectedVersion: 1 });
    const hiddenHistory = f.state.invitations.get(hidden.invitation.id)!, visibleHistory = f.state.invitations.get(visible.invitation.id)!;
    // Pure source-enumeration fixture: distinct historical declined records. No duplicate active invitation violates the DB uniqueness contract.
    f.state.invitations.clear();
    f.state.invitations.set('a-visible', { ...structuredClone(visibleHistory), id: 'a-visible' });
    for (let i = 0; i < 500; i++) { const id = 'hidden-' + String(i).padStart(3, '0'); f.state.invitations.set(id, { ...structuredClone(hiddenHistory), id }); }
    f.state.invitations.set('z-visible', { ...structuredClone(visibleHistory), id: 'z-visible' });
    if (mode === 'withdraw') await command(a, 'interaction.artifact.withdraw', { artifact: hidden.artifact.result.artifact!, expectedVersion: 1 });
    else await command(a, 'interaction.policy.block', { agentId: 'agent-b', expectedVersion: 1 });
    const first = await service.listCurrent(f.context, b, { limit: 1 });
    assert.deepEqual(first.items.map(item => (item.invitation as JsonObject).invitationId), ['a-visible']); assert.equal(first.complete, false); assert.ok(first.nextCursor);
    const original = f.interaction.listInvitations; let examined = 0;
    f.interaction.listInvitations = async (agentId, options) => { const rows = await original(agentId, options); examined += rows.length; return rows; };
    const empty = await service.listCurrent(f.context, b, { limit: 1, cursor: first.nextCursor });
    assert.deepEqual(empty.items, []); assert.equal(empty.complete, false); assert.ok(empty.nextCursor); assert.notEqual(empty.nextCursor, first.nextCursor);
    assert.ok(examined <= 500, 'one query remains bounded even when every scanned record is hidden');
    assert.equal('nextAfterId' in empty, false); assert.equal('scanned' in empty, false);
    assert.equal(Buffer.from(empty.nextCursor.split('.')[2]!, 'base64url').toString('utf8').includes('hidden-499'), false);
    const last = await service.listCurrent(f.context, b, { limit: 1, cursor: empty.nextCursor });
    assert.deepEqual(last.items.map(item => (item.invitation as JsonObject).invitationId), ['z-visible']); assert.equal(last.complete, true); assert.equal(last.nextCursor, null);
    const allOutput = JSON.stringify([first, empty, last]); for (const id of ['hidden-000', 'hidden-499', hidden.invitation.id]) assert.equal(allOutput.includes(id), false);
    // A visible item followed by a hidden final source row must also terminate without returning that hidden cut.
    f.state.invitations.delete('z-visible');
    const tail = await service.listCurrent(f.context, b, { limit: 1, cursor: empty.nextCursor }); assert.deepEqual(tail.items, []); assert.equal(tail.complete, true); assert.equal(tail.nextCursor, null);
  }
});

test('current-items continuations recheck revocation and reject another caller, scope, tampering, expiry or a restarted service', async () => {
  const { f, a, b, c, service, command, invite } = await fixture(), hidden = await invite(a, '可能撤回的共享'), visible = await invite(c, '当前仍可访问');
  await command(b, 'interaction.invitation.decline', { invitationId: visible.invitation.id, expectedVersion: 1 });
  const visibleHistory = f.state.invitations.get(visible.invitation.id)!; f.state.invitations.clear();
  f.state.invitations.set('a-first', { ...structuredClone(visibleHistory), id: 'a-first' });
  f.state.invitations.set('b-revoked', { ...structuredClone(hidden.invitation), id: 'b-revoked' });
  f.state.invitations.set('c-last', { ...structuredClone(visibleHistory), id: 'c-last' });
  const first = await service.listCurrent(f.context, b, { limit: 1 }); assert.ok(first.nextCursor);
  await command(a, 'interaction.artifact.withdraw', { artifact: hidden.artifact.result.artifact!, expectedVersion: 1 });
  const next = await service.listCurrent(f.context, b, { limit: 1, cursor: first.nextCursor }); assert.equal((next.items[0]!.invitation as JsonObject).invitationId, 'c-last');
  assert.equal(JSON.stringify(next).includes('b-revoked'), false); assert.equal(JSON.stringify(next).includes(hidden.invitation.id), false);
  await assert.rejects(service.listCurrent(f.context, c, { limit: 1, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  await assert.rejects(service.listCurrent(f.context, b, { limit: 2, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  await assert.rejects(service.listCurrent({ ...f.context, instanceId: 'other-instance' }, b, { limit: 1, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  await assert.rejects(service.listCurrent({ ...f.context, recoveryEpoch: 'other-epoch' }, b, { limit: 1, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  await assert.rejects(service.listCurrent(f.context, b, { limit: 1, cursor: first.nextCursor + 'x' }), { code: 'interaction_cursor_invalid' });
  await assert.rejects(createInteractionService(f.identity, f.decisions).listCurrent(f.context, b, { limit: 1, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  f.now += 300_000; await assert.rejects(service.listCurrent(f.context, b, { limit: 1, cursor: first.nextCursor }), { code: 'interaction_cursor_invalid' });
  assert.equal(f.state.invitations.size, 3); // Continuation reads do not delete source records.
});

test('current-items filtering preserves real storage/service failures and rejects the obsolete raw-ID input', async () => {
  const { f, a, b, service, invite } = await fixture(); await invite(a, '本例的合法源');
  for (const failure of [new Error('Synthetic database unavailable'), new M1Error('storage_unavailable', 503, 'Synthetic source failure'), new M1Error('source_metadata_missing', 404, 'Unexpected missing source')]) {
    const original = f.interaction.getArtifact; f.interaction.getArtifact = async () => { throw failure; };
    await assert.rejects(service.listCurrent(f.context, b, { limit: 1 }), error => error === failure); f.interaction.getArtifact = original;
  }
  const raw = JSON.parse('{"afterId":"hidden-invitation-id","limit":1}'); await assert.rejects(service.listCurrent(f.context, b, raw), { code: 'invalid_request' });
  f.state.participants.set('agent-b', { ...f.state.participants.get('agent-b')!, runtimeActive: false });
  await assert.rejects(service.listCurrent(f.context, b, { limit: 1 }), { code: 'insufficient_scope' });
});
