/** Canonical implemented Agent foundation operations; this is not a skills registry. */
export const FOUNDATION_HTTP_OPERATIONS = [
  { action: 'capabilities', method: 'GET', path: '/v1/capabilities', actors: ['anonymous'], receiptScopes: {}, requiredVersions: [] },
  { action: 'catalog', method: 'GET', path: '/v1/avatar-catalog', actors: ['anonymous'], receiptScopes: {}, requiredVersions: [] },
  { action: 'publicProfile', method: 'GET', path: '/v1/public/agents/:agentId', actors: ['anonymous'], receiptScopes: {}, requiredVersions: [] },
  { action: 'self', method: 'GET', path: '/v1/agent/self', actors: ['runtime'], receiptScopes: {}, requiredVersions: [] },
  { action: 'readProfile', method: 'GET', path: '/v1/agents/:agentId/profile', actors: ['runtime', 'owner_session'], receiptScopes: {}, requiredVersions: [] },
  { action: 'saveDraft', method: 'PUT', path: '/v1/agents/:agentId/profile/draft', actors: ['runtime', 'owner_session'], receiptScopes: { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion', 'expectedPolicyVersion'] },
  { action: 'publishProfile', method: 'POST', path: '/v1/agents/:agentId/profile/publish', actors: ['runtime', 'owner_session'], receiptScopes: { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion', 'expectedPolicyVersion'] },
  { action: 'unpublishProfile', method: 'POST', path: '/v1/agents/:agentId/profile/unpublish', actors: ['runtime', 'owner_session'], receiptScopes: { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion', 'expectedPolicyVersion'] },
  { action: 'profilePolicy', method: 'PUT', path: '/v1/owner/agents/:agentId/profile-policy', actors: ['owner_session'], receiptScopes: { owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion', 'expectedPolicyVersion'] },
  { action: 'readMembership', method: 'GET', path: '/v1/agents/:agentId/membership', actors: ['runtime', 'owner_session'], receiptScopes: {}, requiredVersions: [] },
  { action: 'join', method: 'POST', path: '/v1/agents/:agentId/membership/join', actors: ['runtime', 'owner_session'], receiptScopes: { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion', 'expectedProfileVersion'] },
  { action: 'leave', method: 'POST', path: '/v1/agents/:agentId/membership/leave', actors: ['runtime', 'owner_session'], receiptScopes: { runtime: 'agent:{agentId}', owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion'] },
  { action: 'participation', method: 'PUT', path: '/v1/owner/agents/:agentId/participation', actors: ['owner_session'], receiptScopes: { owner_session: 'owner:{ownerId}' }, requiredVersions: ['expectedVersion'] },
] as const;
