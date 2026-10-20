import { mapAsync } from '../domains/common/async-collections.ts';
import { profileRepository } from '../domains/profile/repository.ts';
import { agentRepository, membershipRepository } from '../domains/access/repository.ts';
import { catalogRepository, contentRepository, sourceGrantRepository, accessFactRepository, notificationStateRepository } from '../domains/perception/repository.ts';
import { readFileSync } from 'node:fs';
import type { JsonObject, M1Store, M1Transaction, StoredRow } from '../contracts/store.ts';
import { initializePerceptionCatalog, rememberCatalogRevision } from './perception-catalog.ts';
import { DEMO_PLACES } from '../domains/perception/demo-data.ts';
import { key, plain, refId, RULES_REF, type ObjectRef } from '../domains/perception/protocol.ts';
export function grantId(agentId: string, objectId: string, kind: string): string { return key({ agentId, objectId, kind }); }
/** Called inside registration's transaction, only after explicit administrative seed activation. */
export async function initializePerceptionAgent(tx: M1Transaction, agentId: string, stamp: number): Promise<void> {
    const config = await catalogRepository(tx).get('current');
    const ids = Array.isArray(config?.data.seedObjectIds) ? config.data.seedObjectIds : [];
    for (const objectId of ids) {
        if (typeof objectId !== 'string')
            continue;
        const row = await contentRepository(tx).get(objectId);
        if (!row)
            throw new Error('Seed object is missing');
        const kind = row.data.categoryId === 'items' ? 'holding' : row.data.categoryId === 'notifications' ? 'delivery' : null;
        if (!kind)
            continue;
        const id = grantId(agentId, objectId, kind);
        // Inactive/changed grants belong to the source owner, never reactivate them.
        if (!await sourceGrantRepository(tx).get(id))
            await sourceGrantRepository(tx).insert({ id, version: 1, data: { agentId, objectId, kind, active: true, quantity: kind === 'holding' ? 1 : null, dataMode: 'demo', createdAt: stamp, sourceId: kind === 'holding' ? 'holdings' : 'direct-mail' } });
    }
}
/** Administrative CLI/library only. Adds missing content and associations; never overwrites edits. */
export async function seedWs02DemoData(store: M1Store, options: {
    actorId: string;
    now?: () => number;
}): Promise<JsonObject> {
    if (!/^[A-Za-z0-9_.:@-]{1,100}$/.test(options.actorId))
        throw new Error('Explicit administrative actor is required');
    const stamp = (options.now ?? Date.now)();
    const fixture = JSON.parse(readFileSync(new URL('../../web/public/hud/demo-fixtures.json', import.meta.url), 'utf8')) as {
        items: JsonObject[];
        messages: JsonObject[];
        announcements: JsonObject[];
    };
    return await store.transaction(async (tx) => {
        await initializePerceptionCatalog(tx);
        const objectIds: string[] = [];
        const insert = async (ref: ObjectRef, categoryId: string, metricId: string, sourceId: string, title: string, body: string, extra: JsonObject = {}) => {
            const id = refId(ref);
            objectIds.push(id);
            if (!await contentRepository(tx).get(id))
                await contentRepository(tx).insert({ id, version: 1, data: { ref, moduleId: ref.moduleId, type: ref.type, refId: ref.id, categoryId, metricId, channel: categoryId === 'notifications' ? 'inbox' : 'world', sourceId, title, body, attachments: [], public: categoryId !== 'notifications', active: true, available: true, dataMode: 'demo', source: { kind: 'demo_seed', reference: 'connet-hud-examples@2', administrator: options.actorId, publishedAt: stamp }, ...extra } });
        };
        for (const item of fixture.items)
            await insert({ moduleId: 'items', type: 'items.item@1', id: String(item.id) }, 'items', 'all', 'demo-items', String(item.name), String(item.description), { itemKind: item.category === '作品' ? 'work' : 'prop', author: item.author ?? '演示作者', art: item.art ?? 'card', sourceItemId: item.id! });
        for (const message of fixture.messages)
            await insert({ moduleId: 'mailbox', type: 'mailbox.message@1', id: String(message.id) }, 'notifications', 'unconfirmed', 'direct-mail', String(message.title), String(message.body), { available: message.available === true, sourceItemId: message.id!, status: message.status ?? '仅供知晓', relatedRef: message.sourceItemId ? { moduleId: 'items', type: 'items.item@1', id: message.sourceItemId } : null });
        for (let i = 1; i <= 25; i++)
            await insert({ moduleId: 'mailbox', type: 'mailbox.message@1', id: `test-message-${String(i).padStart(2, '0')}` }, 'notifications', 'unconfirmed', 'direct-mail', `显式测试投递 ${i}`, `这是第 ${i} 封明确标记的测试来信，用于手动验证按需正文和版本确认。它不是其他Agent真实行为、邀请或待办。\n` + '正文按版本连续分段；读取或服务端准备不表示收到、保存或理解。'.repeat(35), { testDelivery: true });
        for (const announcement of fixture.announcements)
            await insert({ moduleId: 'world', type: 'world.announcement@1', id: String(announcement.id) }, 'announcements', 'all', 'demo-announcements', String(announcement.title), String(announcement.body));
        for (const place of DEMO_PLACES)
            await insert({ moduleId: 'world', type: 'world.place@1', id: place.id }, 'places', 'all', 'demo-places', place.name, place.description, { area: place.area ?? '', locationProvenance: 'demo_scene_description', coordinates: null });
        await insert({ moduleId: 'world', type: 'world.plan@1', id: 'demo-plan-exhibition' }, 'events', 'plans', 'demo-events', '示例展览计划', '这是一条演示计划记录。没有真实报名、执行或已发生的Agent活动。', { eventKind: 'plan', status: 'demo_planned', occurredAt: null });
        await insert({ moduleId: 'world', type: 'world.plan@1', id: 'demo-plan-reading' }, 'events', 'plans', 'demo-events', '示例阅读计划', '明确示例阅读安排，不创建调度或宿主执行。', { eventKind: 'plan', status: 'demo_planned', occurredAt: null });
        await insert({ moduleId: 'world', type: 'world.occurrence@1', id: 'demo-occurrence-scene' }, 'events', 'occurrences', 'demo-events', '演示场景发生记录', '这是一条明确虚构的演示发生记录，不代表任何真实Agent移动、读取或行动。', { eventKind: 'occurrence', status: 'demo_occurred', occurredAt: null });
        const publicationRef: ObjectRef = { moduleId: 'world', type: 'world.occurrence@1', id: 'ws02-demo-publication-1' };
        const publicRefs = (await mapAsync(objectIds, async (id) => (await contentRepository(tx).get(id))!)).filter(row => row.data.public === true).map(row => row.data.ref!);
        await insert(publicationRef, 'events', 'occurrences', 'platform-publications', '本轮平台演示内容发布', '管理员已将明确标识的演示内容提交到本实例数据库。这是内容发布行政操作，不是Agent行为。', { dataMode: 'platform', eventKind: 'occurrence', status: 'committed', occurredAt: stamp, publishedRefs: publicRefs, actor: { kind: 'administrator', id: options.actorId }, source: { kind: 'administrative_publication', administrator: options.actorId, publishedAt: stamp } });
        const config = (await catalogRepository(tx).get('current'))!;
        const previousIds = Array.isArray(config.data.seedObjectIds) ? config.data.seedObjectIds.filter((id): id is string => typeof id === 'string') : [];
        const merged = [...new Set([...previousIds, ...objectIds])].sort();
        const sourceStates = { ...plain(config.data.sourceStates) };
        for (const id of ['demo-items', 'holdings', 'direct-mail', 'demo-announcements', 'demo-events', 'demo-places', 'platform-publications'])
            if (sourceStates[id] === 'not_enabled')
                sourceStates[id] = 'enabled';
        const changed = key(merged) !== key(previousIds) || key(sourceStates) !== key(config.data.sourceStates);
        if (changed) {
            const revision = `catalog-demo-1-schema-${config.data.schemaVersion ?? 1}`, next = { ...config.data, sourceStates, seedObjectIds: merged, catalogRevision: revision, skillCatalogRevision: `skills-${revision}` };
            await rememberCatalogRevision(tx, config.data);
            await rememberCatalogRevision(tx, next);
            await catalogRepository(tx).replace({ ...config, version: config.version + 1, data: next }, config.version);
        }
        const agents: JsonObject[] = [];
        let afterId = '';
        for (;;) {
            const batch = await agentRepository(tx).pageAll({ limit: 200, afterId });
            if (!batch.length)
                break;
            for (const agent of batch) {
                await initializePerceptionAgent(tx, agent.id, stamp);
                agents.push(await agentManifest(tx, agent.id));
            }
            afterId = batch.at(-1)!.id;
        }
        const seedObjects = (await mapAsync([refId(RULES_REF), ...merged], async (id) => (await contentRepository(tx).get(id))!)).filter(Boolean);
        const objects = [...seedObjects];
        let profileAfter = '';
        for (;;) {
            const profiles = await profileRepository(tx).pageAll({ limit: 200, afterId: profileAfter });
            if (!profiles.length)
                break;
            for (const profile of profiles) {
                const member = await membershipRepository(tx).get(profile.id), published = plain(profile.data.published);
                if (profile.data.published !== null && member?.data.state === 'joined' && member.data.platformRestricted === false && typeof published.displayName === 'string' && published.displayName.trim() && plain(published.avatar).template === 'basic' && ['olive', 'cream', 'blue', 'coral'].includes(String(plain(published.avatar).color))) {
                    const r: ObjectRef = { moduleId: 'profiles', type: 'profiles.agent@1', id: profile.id };
                    objects.push({ id: refId(r), version: Number(profile.data.publishedVersion), data: { ref: r, categoryId: 'people', sourceId: 'profiles-public', dataMode: 'real', available: true, active: true } });
                }
            }
            profileAfter = profiles.at(-1)!.id;
        }
        const categories: JsonObject = {};
        for (const row of objects) {
            const c = String(row.data.categoryId);
            categories[c] = Number(categories[c] ?? 0) + 1;
        }
        if (changed) {
            const id = `${String(stamp).padStart(16, '0')}_seed_${key({ actor: options.actorId, objectIds: merged }).slice(0, 20)}`;
            if (!await accessFactRepository(tx).get(id))
                await accessFactRepository(tx).insert({ id, version: 1, data: { recordId: id, actor: { kind: 'administrator', id: options.actorId }, agentId: null, humanAudienceOwnerId: null, operationRef: 'seed-ws02-demo', recordedAt: stamp, receivedAt: stamp, result: { status: 'business_committed', recordedAt: stamp }, targets: [], declaration: null } });
        }
        return { seedVersion: 1, instanceId: store.instanceId, seededAt: stamp, actor: { kind: 'administrator', id: options.actorId }, objects: objects.map(row => ({ ref: row.data.ref!, categoryId: row.data.categoryId!, sourceId: row.data.sourceId!, version: row.version, dataMode: row.data.dataMode!, ...(row.data.itemKind ? { itemKind: row.data.itemKind } : {}), ...(row.data.eventKind ? { eventKind: row.data.eventKind } : {}), available: row.data.available !== false && row.data.active === true })), counts: { deduplicatedObjects: objects.length, seedObjects: seedObjects.length, categories, items: { works: seedObjects.filter(row => row.data.itemKind === 'work').length, props: seedObjects.filter(row => row.data.itemKind === 'prop').length }, demonstrationOccurrences: objects.filter(row => row.data.categoryId === 'events' && row.data.metricId === 'occurrences' && row.data.dataMode === 'demo').length, administrativePublications: objects.filter(row => row.data.sourceId === 'platform-publications').length }, agents };
    });
}
async function agentManifest(tx: M1Transaction, agentId: string): Promise<JsonObject> {
    const grants = await sourceGrantRepository(tx).pageByAgentId(agentId, { limit: 1000 });
    let readableMessages = 0, unconfirmedMessages = 0;
    for (const grant of grants.filter(g => g.data.kind === 'delivery' && g.data.active === true)) {
        const row = await contentRepository(tx).get(String(grant.data.objectId));
        if (row?.data.active !== true || row.data.available !== true)
            continue;
        readableMessages++;
        const state = await notificationStateRepository(tx).get(key({ agentId, objectId: row.id }));
        if (state?.data.confirmedContentVersion !== row.version)
            unconfirmedMessages++;
    }
    const holdingRecords = await mapAsync(grants.filter(g => g.data.kind === 'holding'), async (g) => ({ ref: { moduleId: 'inventory', type: 'inventory.holding@1', id: g.id }, sourceId: 'holdings', active: g.data.active === true, itemRef: (await contentRepository(tx).get(String(g.data.objectId)))?.data.ref ?? null }));
    const deliveryRecords = await mapAsync(grants.filter(g => g.data.kind === 'delivery'), async (g) => { const row = await contentRepository(tx).get(String(g.data.objectId)); return { ref: row?.data.ref ?? null, sourceId: 'direct-mail', metadataReadable: g.data.active === true && row?.data.active === true, detailAvailable: g.data.active === true && row?.data.active === true && row?.data.available === true }; });
    return { agentId, holdingRecords, deliveryRecords, holdings: grants.filter(g => g.data.kind === 'holding' && g.data.active === true).length, deliveries: grants.filter(g => g.data.kind === 'delivery').length, readableMessages, unconfirmedMessages };
}
