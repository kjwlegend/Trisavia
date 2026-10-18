import { loadEmailConfig, type EmailConfig } from '../infrastructure/email/resend.ts';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface BackendConfig {
  email?: EmailConfig;
  host: string;
  port: number;
  trustProxyLoopback: boolean;
  databasePath: string;
  identityPath: string | null;
  instanceId: string;
  recoveryEpoch: string;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{3,128}$/.test(value);
}

/** Local configuration only. No model credentials or user runtime tokens are accepted here. */
export function loadBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): BackendConfig {
  const email = loadEmailConfig(env);
  const host = env.M1_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('M1_HOST must be a loopback address for this local candidate');
  }
  const proxyText = env.M1_TRUST_PROXY_LOOPBACK ?? '0';
  if (proxyText !== '0' && proxyText !== '1') {
    throw new Error('M1_TRUST_PROXY_LOOPBACK must be 0 or 1');
  }
  const trustProxyLoopback = proxyText === '1';
  const portText = env.M1_PORT ?? '8787';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error('M1_PORT must be an integer between 0 and 65535');
  }
  const databasePath = env.M1_DATABASE_PATH === ':memory:'
    ? ':memory:'
    : resolve(cwd, env.M1_DATABASE_PATH ?? 'data/m1.sqlite');
  for (const key of ['M1_INSTANCE_ID', 'M1_RECOVERY_EPOCH'] as const) {
    if (env[key] !== undefined && !identifier(env[key])) {
      throw new Error(`${key} must be a valid opaque identifier`);
    }
  }
  if (databasePath === ':memory:') {
    return {
      host, port, trustProxyLoopback, databasePath, identityPath: null, ...(email ? { email } : {}),
      instanceId: env.M1_INSTANCE_ID ?? `instance_${randomUUID()}`,
      recoveryEpoch: env.M1_RECOVERY_EPOCH ?? `epoch_${randomUUID()}`,
    };
  }
  const identityPath = resolve(cwd, env.M1_IDENTITY_PATH ?? `${databasePath}.identity.json`);
  if (identityPath === databasePath) throw new Error('Identity metadata must be separate from the database');
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(identityPath), { recursive: true, mode: 0o700 });
  let identity: unknown;
  try {
    identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error('Identity metadata is unreadable or invalid; refusing to regenerate it');
    }
    if (existsSync(databasePath)) {
      throw new Error('Identity metadata is missing for an existing database; explicit recovery is required');
    }
    const created = {
      version: 1,
      instanceId: env.M1_INSTANCE_ID ?? `instance_${randomUUID()}`,
      recoveryEpoch: env.M1_RECOVERY_EPOCH ?? `epoch_${randomUUID()}`,
    };
    try {
      writeFileSync(identityPath, `${JSON.stringify(created)}\n`, { flag: 'wx', mode: 0o600 });
      identity = created;
    } catch (creationError) {
      if (!(creationError instanceof Error && 'code' in creationError && creationError.code === 'EEXIST')) {
        throw creationError;
      }
      identity = JSON.parse(readFileSync(identityPath, 'utf8'));
    }
  }
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('Identity metadata has an invalid shape');
  }
  const saved = identity as Record<string, unknown>;
  if (saved.version !== 1 || !identifier(saved.instanceId) || !identifier(saved.recoveryEpoch)) {
    throw new Error('Identity metadata has an unsupported version or invalid identifiers');
  }
  if ((env.M1_INSTANCE_ID && env.M1_INSTANCE_ID !== saved.instanceId)
      || (env.M1_RECOVERY_EPOCH && env.M1_RECOVERY_EPOCH !== saved.recoveryEpoch)) {
    throw new Error('Environment identity conflicts with saved metadata; resolve it explicitly');
  }
  return { host, port, trustProxyLoopback, databasePath, identityPath, ...(email ? { email } : {}), instanceId: saved.instanceId, recoveryEpoch: saved.recoveryEpoch };
}
