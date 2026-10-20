import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { publishPerceptionCatalog } from '../../apps/platform/application/perception-catalog.ts';
import type { Json } from '../../scripts/agent-manager-qa-fixture.ts';
import { fixture, requestBase } from './helpers.ts';

// Ajv 2020 is already locked by Fastify's @fastify/ajv-compiler dependency.
// npm ci supplies it; no additional install, external schema fetch or test-only
// reconstruction of the platform's schema rules is used here.
const Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default;

test('HTTP-discovered exact schemas validate actual envelopes and content, and public digest bytes are independently reproducible', async t => {
  const f = await fixture(t), directory = await f.read('GET', '/discovery?limit=50');
  const humanDirectory = await f.read('GET', '/discovery?limit=50', undefined, f.owner.sessionToken);
  let validationChecks = 0;
  const operations = new Map<string, Json>([...directory.operations, ...humanDirectory.operations].map((row: Json) => [row.id, row]));
  const documents = new Map<string, Json>(), replies: { kind: string; envelope: Json }[] = [];
  async function document(kind: 'schema' | 'guide', id: string, version: number) {
    const key = `${kind}:${id}:${version}`; if (documents.has(key)) return documents.get(key)!;
    const response = await f.call('GET', `/${kind === 'schema' ? 'schemas' : 'guides'}/${encodeURIComponent(id)}?version=${version}`);
    assert.equal(response.status, 200); const data = response.data;
    assert.equal(data.digestAlgorithm, 'sha256-utf8-hex'); assert.equal(typeof data.canonicalDocument, 'string');
    assert.deepEqual(JSON.parse(data.canonicalDocument), data.document, 'The exact digest input must describe the same received document');
    assert.equal(createHash('sha256').update(data.canonicalDocument, 'utf8').digest('hex'), data.digest,
      'An ordinary HTTP consumer can verify the supplied UTF-8 bytes without reproducing a Node/locale sort');
    assert.equal(data.version, version); assert.equal(data[kind === 'schema' ? 'schemaId' : 'moduleId'], id);
    documents.set(key, data); replies.push({ kind, envelope: response.envelope }); return data;
  }
  const validators = new Map<string, any>();
  async function validates(reference: Json, value: unknown) {
    const key = `${reference.id}:${reference.version}`;
    let validate = validators.get(key);
    if (!validate) {
      const schema = await document('schema', reference.id, reference.version);
      const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
      validate = ajv.compile(schema.document); validators.set(key, validate);
    }
    assert(validate(value), `${key}: ${(validate.errors ?? []).map((error: Json) => `${error.instancePath}:${error.keyword}`).join(', ')}`);
    validationChecks++;
  }
  async function receive(id: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: Json, token = f.a.runtimeToken) {
    const operation = operations.get(id); assert(operation, `A public directory describes ${id}`);
    if (body) await validates(operation.inputSchema, body);
    const response = await f.call(method, path, body, token); assert.equal(response.status, 200);
    await validates(operation.outputSchema, response.envelope); return response.data;
  }
  await receive('discovery', 'GET', '/discovery?limit=50');
  await receive('overview', 'POST', '/overview', { protocolVersion: 1, consumerId: 'schema-consumer', purpose: 'agent-perception' });
  let completeMessage: Json | undefined;
  const inspectedTypes = new Set<string>();
  for (const [channel, categoryId] of [['world', 'people'], ['world', 'items'], ['world', 'events'], ['world', 'announcements'],
    ['world', 'places'], ['world', 'rules'], ['inventory', 'holdings'], ['inbox', 'notifications']] as const) {
    const page = await receive('list', 'POST', '/list', requestBase(channel, { categoryId, limit: 50 }));
    assert.equal(page.complete, true);
    for (const record of page.records) {
      const type = directory.types.find((row: Json) => row.type === record.ref.type); assert(type);
      assert.equal(record.schema.version, 3); assert.deepEqual(record.schema, type.summarySchema);
      await validates(record.schema, record.summary);
      if (!record.detailAvailable || inspectedTypes.has(record.ref.type)) continue;
      inspectedTypes.add(record.ref.type);
      let contentToken: string | undefined;
      for (let index = 0; index < 128; index++) {
        const body = { ...requestBase(channel, { purpose: 'agent-inspect' }), ref: record.ref, ...(contentToken ? { contentToken } : {}) };
        const detail = await receive('detail', 'POST', '/detail', body);
        assert.deepEqual(detail.schema, type.detailSchema); assert.equal(detail.schema.version, 3);
        await validates(detail.schema, detail.content);
        if (detail.contentComplete) {
          if (channel === 'inbox') completeMessage = detail;
          break;
        }
        assert.equal(typeof detail.nextContentToken, 'string'); contentToken = detail.nextContentToken;
        assert(index < 127, 'A declared continuous detail chain must reach a final same-version segment');
      }
    }
  }
  assert(completeMessage);
  await receive('agent-read-state-query', 'POST', '/agent-read-state/query', { protocolVersion: 1, ref: completeMessage.ref });
  const confirmation = { protocolVersion: 1, operationId: randomUUID(), ref: completeMessage.ref,
    contentVersion: completeMessage.version, completionToken: completeMessage.completionToken };
  await receive('agent-read-state-confirm', 'PUT', '/agent-read-state', confirmation);
  await receive('activity-query', 'POST', '/activity/query', { protocolVersion: 1,
    agentRef: { moduleId: 'profiles', type: 'profiles.agent@1', id: f.a.agentId }, limit: 50 }, f.owner.sessionToken);
  const guideReference = directory.modules.find((row: Json) => row.moduleId === 'world').usageGuide;
  const guide = await document('guide', guideReference.moduleId, guideReference.version);
  assert(guide.document.http.digestVerification, 'The public guide explains its digest verification without requiring source code');
  const invalidResponses = [
    { id: 'overview', method: 'POST' as const, path: '/overview', body: { protocolVersion: 1, consumerId: 'schema-consumer', purpose: 'agent-perception' }, token: null, status: 401 },
    { id: 'list', method: 'POST' as const, path: '/list', body: requestBase('world', { categoryId: 'items', budget: null }), token: f.a.runtimeToken, status: 400 },
    { id: 'detail', method: 'POST' as const, path: '/detail', body: { ...requestBase('inbox', { purpose: 'agent-inspect' }),
      ref: { ...completeMessage.ref, id: `missing-${randomUUID()}` } }, token: f.a.runtimeToken, status: 404 },
    { id: 'detail', method: 'POST' as const, path: '/detail', body: { ...requestBase('inbox', { purpose: 'agent-inspect' }),
      ref: completeMessage.ref, budget: { maxResponseBytes: 1 } }, token: f.a.runtimeToken, status: 422 },
    { id: 'agent-read-state-confirm', method: 'PUT' as const, path: '/agent-read-state',
      body: { ...confirmation, contentVersion: confirmation.contentVersion + 1 }, token: f.a.runtimeToken, status: 409 },
  ];
  for (const expected of invalidResponses) {
    const response = await f.call(expected.method, expected.path, expected.body, expected.token);
    assert.equal(response.status, expected.status);
    const schema = operations.get(expected.id)!.errorSchema; assert(schema); assert.equal(schema.version, 3);
    await validates(schema, response.envelope);
  }
  // Document endpoints are themselves checked against their actual advertised
  // result schemas, including the document-result schema's own response.
  const schemaOperation = operations.get('schema')!, guideOperation = operations.get('guide')!;
  await document('schema', schemaOperation.outputSchema.id, schemaOperation.outputSchema.version);
  await document('schema', guideOperation.outputSchema.id, guideOperation.outputSchema.version);
  for (let index = 0; index < replies.length; index++) {
    const reply = replies[index]!;
    await validates(operations.get(reply.kind)!.outputSchema, reply.envelope);
  }
  const schemaReference = operations.get('overview')!.inputSchema;
  const old = await document('schema', schemaReference.id, schemaReference.version);
  f.storage(store => publishPerceptionCatalog(store, { revision: 'schema-consumer-next', guideVersion: guideReference.version + 1,
    guideText: 'A later explicit guide publication must preserve prior document bytes.' }));
  const prior = await f.read('GET', `/schemas/${encodeURIComponent(old.schemaId)}?version=${old.version}`);
  assert.deepEqual(prior, old);
  assert.deepEqual(await f.read('GET', `/guides/${encodeURIComponent(guideReference.moduleId)}?version=${guideReference.version}`), guide,
    'The genuinely existing older guide version remains byte-for-byte verifiable after a later publication');
  t.diagnostic(JSON.stringify({ schemaValidationChecks: validationChecks, distinctDetailTypes: inspectedTypes.size,
    independentlyHashedDocuments: documents.size, preservedGuideVersion: guideReference.version }));
});
