import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect, idle, mutation, prepareRegistration, loginIdentifier, logout, openHandoff, trackBackup } from './helpers/owner-account-ui.ts';
import { accountFixture, agentFixture, credential, externalInvitedAgent, fixtureOk, fixtureRequest, handoffFixture,
  operationId, privateDirectory, privateDownload, privateJson } from './helpers/private-fixtures.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const names = () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  return { username: `QA_${suffix}`, email: `qa_${suffix}@example.test`, password: `Synthetic-${randomUUID()}` };
};

test('visible registration saves a backup, creates a genuinely empty account and logs into the same owner by username or email', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-register-');
  try {
    const input = names();
    const backup = await prepareRegistration(page, directory, privacy, input, true);
    expect((await fixtureRequest(baseURL!, '/owner/account', undefined, backup.sessionToken)).status, 'A downloaded backup is not a committed account').toBe(401);
    const receipt = await mutation(page, '/owner/accounts', page.locator('#register-submit'));
    expect(receipt.ownerId).toBe(backup.ownerId); expect(JSON.stringify(receipt).includes(input.email), 'Registration receipt does not expose private email').toBe(false);
    await expect(page.getByRole('heading', { name: '我的 Agent', exact: true })).toBeVisible();
    await expect(page.locator('#empty-agents')).toContainText('你还没有关联的 Agent。');
    await expect(page.locator('#empty-invite')).toBeVisible();
    expect((await page.locator('main').innerText()).includes(backup.ownerId), 'Random internal owner ID is not the default account identity').toBe(false);
    const current = await fixtureOk(baseURL!, '/owner/account', undefined, backup.sessionToken);
    expect(current.username).toBe(input.username); expect(current.emailVerified).toBe(false); expect(current.accountComplete).toBe(true);
    for (const identifier of [input.username.toLowerCase(), ` ${input.email.toUpperCase()} `]) {
      await logout(page); await loginIdentifier(page, privacy, identifier, input.password);
      await expect(page.locator('#empty-agents')).toBeVisible();
      expect((await fixtureOk(baseURL!, '/owner/agents', undefined, backup.sessionToken)).agents).toHaveLength(0);
    }
    await logout(page);
    await page.locator('#login-identifier').fill(input.username); await page.locator('#login-password').fill('Wrong synthetic account password');
    privacy.allowStatus('/v1/owner/sessions', 401);
    await mutation(page, '/owner/sessions', page.locator('#login-submit'), 401);
    await expect(page.locator('#login-identifier')).toBeEnabled(); await expect(page.locator('#manage-view')).toBeHidden();
    await expect(page.getByRole('button', { name: '忘记密码？', exact: true })).toBeEnabled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty owner invites two independent external CLI Agents, switches targets and retains both after ordinary login', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-invites-');
  try {
    const input = names(), backup = await prepareRegistration(page, directory, privacy, input);
    await mutation(page, '/owner/accounts', page.locator('#register-submit'));
    const agents = [];
    for (let index = 0; index < 2; index++) {
      if (index === 0) await page.locator('#empty-invite').click(); else await page.locator('#add-agent').click();
      const invite = await privateDownload(page, page.locator('#prepare-invite'), directory); privacy.track(invite.inviteToken);
      await expect(page.locator('#issue-invite')).toBeDisabled(); await page.locator('#invite-saved').check();
      await mutation(page, '/owner/agent-invites', page.locator('#issue-invite'));
      expect(JSON.stringify(invite).includes(input.email), 'An invitation carries no private owner email').toBe(false);
      agents.push(await externalInvitedAgent(baseURL!, directory, invite, `中文 Agent ${index + 1}`));
      await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await idle(page);
      await expect(page.locator('#agent-count')).toHaveText(String(index + 1));
    }
    expect(agents[0]!.state.runtimeToken !== agents[1]!.state.runtimeToken).toBe(true);
    for (const agent of agents) {
      expect(agent.summary.ownerId).toBe(backup.ownerId);
      const selector = page.getByTestId('agent-select');
      if (await selector.isVisible()) await selector.selectOption(agent.summary.agentId);
      else await page.locator('#agent-list').getByRole('button').filter({ hasText: agent.name }).click();
      await expect(page.locator('#selected-id')).toContainText(agent.summary.agentId);
      await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(agent.name);
    }
    await logout(page); await loginIdentifier(page, privacy, input.email, input.password);
    await expect(page.locator('#agent-count')).toHaveText('2');
    for (const agent of agents) {
      const self = await fixtureOk(baseURL!, '/agent/self', undefined, agent.state.runtimeToken);
      expect(self.agentId).toBe(agent.summary.agentId); expect(self.ownerId).toBe(backup.ownerId);
      expect(JSON.stringify(self).includes(input.email), 'Runtime self does not disclose owner email').toBe(false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an Agent exists before its human creates an account through the private handoff', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-handoff-new-');
  try {
    const agent = await agentFixture(baseURL!, directory, '先加入的中文 Agent'), handoff = await handoffFixture(baseURL!, directory, agent), input = names();
    privacy.password(input.password); privacy.track(agent.runtimeToken, agent.continuationToken, input.email);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken)).membership.state).toBe('joined');
    await openHandoff(page, privacy, handoff.handoffToken);
    await expect(page.locator('#setup-view')).toContainText(agent.name);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken)).management.managementStatus).toBe('pending_setup');
    if (await page.locator('#setup-start').isVisible()) await mutation(page, '/owner-setups', page.locator('#setup-start'));
    await page.locator('#setup-username').fill(input.username); await page.locator('#setup-email').fill(input.email);
    await page.locator('#setup-password').fill(input.password); await page.locator('#setup-next').click();
    const backup = await privateDownload(page, page.locator('#credentials-download'), directory); trackBackup(privacy, backup);
    await expect(page.locator('#setup-complete')).toBeDisabled(); await page.locator('#setup-saved').check();
    await mutation(page, '/owner/setup/complete', page.locator('#setup-complete'));
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
    const self = await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken);
    expect(self.agentId).toBe(agent.agentId); expect(self.ownerId).toBe(agent.ownerId); expect(self.membership.state).toBe('joined');
    expect((await fixtureOk(baseURL!, '/owner/account', undefined, backup.sessionToken)).username).toBe(input.username);
    await logout(page); await loginIdentifier(page, privacy, input.username, input.password);
    await expect(page.locator('#selected-id')).toContainText(agent.agentId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an existing owner explicitly confirms a private Agent claim without replacing the account password, recovery or prior Agent', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-existing-claim-');
  try {
    const owner = await accountFixture(baseURL!, directory), inviteToken = credential();
    await fixtureOk(baseURL!, '/owner/agent-invites', { operationId: operationId(), inviteToken }, owner.sessionToken);
    const first = await agentFixture(baseURL!, directory, 'Existing owner first Agent', inviteToken);
    const second = await agentFixture(baseURL!, directory, 'Unclaimed Agent'), handoff = await handoffFixture(baseURL!, directory, second);
    await loginIdentifier(page, privacy, owner.username, owner.password);
    const notice = page.locator('#global-notice');
    await expect(notice).toHaveClass(/success/);
    const priorSuccess = (await notice.textContent())!;
    let claims = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/v1/owner/agent-claims' && request.method() === 'POST') claims++; });
    await openHandoff(page, privacy, handoff.handoffToken, true);
    await expect(page.locator('#claim-view')).toBeVisible(); await expect(page.locator('#claim-view')).toContainText(owner.username);
    await expect(page.locator('#claim-view')).toContainText(second.name);
    await expect(notice, 'A new Agent preview cannot retain the previous account operation success').not.toHaveClass(/success/);
    await expect(notice).not.toHaveText(priorSuccess); expect(claims).toBe(0);
    expect((await fixtureOk(baseURL!, '/owner/agents', undefined, owner.sessionToken)).agents.map((entry: any) => entry.agentId)).toEqual([first.agentId]);
    await page.locator('#claim-cancel').click(); await expect(page.locator('#claim-view')).toBeHidden();
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken)).management.managementStatus).toBe('pending_setup');
    await openHandoff(page, privacy, handoff.handoffToken, true);
    await expect(notice).not.toHaveClass(/success/); expect(claims).toBe(0);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/v1/owner/agent-claims', async route => { enter(); await gate; await route.continue(); }, { times: 1 });
    const confirmation = mutation(page, '/owner/agent-claims', page.locator('#claim-confirm'));
    try {
      await entered;
      await expect(notice, 'Confirming a claim does not announce success before the backend receives it').not.toHaveClass(/success/);
      expect((await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken)).management.managementStatus).toBe('pending_setup');
    } finally { release(); }
    await confirmation;
    await expect(notice, 'Only the successful current claim may display completion').toHaveClass(/success/);
    expect(claims).toBe(1);
    await expect(page.locator('#agent-count')).toHaveText('2');
    const list = await fixtureOk(baseURL!, '/owner/agents', undefined, owner.sessionToken);
    expect(list.agents.map((entry: any) => entry.agentId).sort()).toEqual([first.agentId, second.agentId].sort());
    expect((await fixtureOk(baseURL!, '/owner/recovery', undefined, owner.recoveryToken)).ownerId).toBe(owner.ownerId);
    expect((await fixtureOk(baseURL!, '/agent/self', undefined, second.runtimeToken)).ownerId).toBe(owner.ownerId);
    const publicProfile = await fixtureOk(baseURL!, `/public/agents/${second.agentId}`);
    expect(JSON.stringify(publicProfile).includes(owner.email), 'Public profiles do not disclose private owner email').toBe(false);
    await logout(page); await loginIdentifier(page, privacy, owner.email, owner.password);
    await expect(page.locator('#agent-count')).toHaveText('2');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('own v2 recovery backup restores the same username, owner and two independent Agents', async ({ page, baseURL, privacy }) => {
  const directory = await privateDirectory('m1-account-recovery-');
  try {
    const owner = await accountFixture(baseURL!, directory), agents = [];
    for (const name of ['Recovery first Agent', '恢复后的第二位']) {
      const inviteToken = credential();
      await privateJson(directory, 'invite', { inviteToken });
      await fixtureOk(baseURL!, '/owner/agent-invites', { operationId: operationId(), inviteToken }, owner.sessionToken);
      agents.push(await agentFixture(baseURL!, directory, name, inviteToken));
    }
    const password = `Recovered-${randomUUID()}`; privacy.password(password); privacy.track(owner.recoveryToken);
    await page.goto('/owner'); await page.getByRole('button', { name: '忘记密码？', exact: true }).click();
    await page.locator('#credentials-import').setInputFiles(await privateJson(directory, 'own-v2-backup', owner.backup));
    await page.locator('#recovery-password').fill(password); await page.locator('#recovery-next').click();
    const next = await privateDownload(page, page.locator('#recovery-download'), directory); trackBackup(privacy, next);
    expect(next.format).toBe('connet-owner-v2'); expect(next.ownerId).toBe(owner.ownerId);
    await page.locator('#recovery-saved').check(); await mutation(page, '/owner/recoveries', page.locator('#recovery-submit'));
    const account = await fixtureOk(baseURL!, '/owner/account', undefined, next.sessionToken);
    expect(account.ownerId).toBe(owner.ownerId); expect(account.username).toBe(owner.username); expect(account.email).toBe(owner.email);
    const expectedIds = agents.map(agent => agent.agentId).sort();
    expect((await fixtureOk(baseURL!, '/owner/agents', undefined, next.sessionToken)).agents.map((agent: any) => agent.agentId).sort()).toEqual(expectedIds);
    for (const agent of agents) expect((await fixtureOk(baseURL!, '/agent/self', undefined, agent.runtimeToken)).agentId).toBe(agent.agentId);
    expect(agents[0]!.runtimeToken !== agents[1]!.runtimeToken, 'Recovery does not merge independent runtime identities').toBe(true);
    expect((await fixtureRequest(baseURL!, '/owner/recovery', undefined, owner.recoveryToken)).status).toBe(401);
    for (const identifier of [owner.username, owner.email]) {
      await logout(page); await loginIdentifier(page, privacy, identifier, password);
      await expect(page.locator('#agent-count')).toHaveText('2');
      for (const agent of agents) {
        const selector = page.getByTestId('agent-select');
        if (await selector.isVisible()) await selector.selectOption(agent.agentId);
        else await page.locator('#agent-list').getByRole('button').filter({ hasText: agent.name }).click();
        await expect(page.locator('#selected-id')).toContainText(agent.agentId);
        await expect(page.getByLabel('居民名字', { exact: true })).toHaveValue(agent.name);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
