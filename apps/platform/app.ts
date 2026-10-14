import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { createM1Service } from './application/m1-service.ts';
import { openM1Store } from './infrastructure/relational/sqlite-store.ts';
import { registerM1Routes } from './transport/http/m1-routes.ts';

export interface BuildAppOptions {
  databasePath?: string;
  instanceId?: string;
  recoveryEpoch?: string;
  clock?: () => number;
}

/** Build without listening. Persistent callers must supply their saved instance identity. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const databasePath = options.databasePath ?? ':memory:';
  if (databasePath !== ':memory:' && (!options.instanceId || !options.recoveryEpoch)) {
    throw new Error('Persistent databases require an explicit instanceId and recoveryEpoch');
  }
  const store = openM1Store({
    databasePath,
    instanceId: options.instanceId ?? `instance_${randomUUID()}`,
    recoveryEpoch: options.recoveryEpoch ?? `epoch_${randomUUID()}`,
  });
  try {
    const app = Fastify({ logger: false, disableRequestLogging: true, bodyLimit: 16 * 1024 });
    app.addHook('onClose', async () => { store.close(); });
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
    });
    app.get('/health', (_request, reply) => {
      try {
        return store.read(() => ({ status: 'ok', phase: 'M1', apiVersion: '1', instanceId: store.instanceId }));
      } catch {
        return reply.code(503).send({ status: 'unavailable', error: { code: 'storage_unavailable' } });
      }
    });
    const service = createM1Service(store, options.clock ? { now: options.clock } : {});
    registerM1Routes(app, service);
    return app;
  } catch (error) {
    store.close();
    throw error;
  }
}
