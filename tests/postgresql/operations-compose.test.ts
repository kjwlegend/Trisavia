import assert from 'node:assert/strict';
import test from 'node:test';
import { compose, docker, readRuntime, runtimeObservation, type ContainerObservation } from '../../scripts/postgresql/runtime.ts';

test('four conflicting inherited Compose variables cannot replace the validated image, loopback port, project/volume or secret directory', async () => {
  const file = process.env.M1_PG_RUNTIME_FILE; if (!file) throw new Error('A private isolated runtime configuration is required');
  const config = await readRuntime(file), inherited = { ...process.env, CONNET_PG_IMAGE: 'postgres:latest', CONNET_PG_PORT: '8789',
    CONNET_PG_PROJECT: 'unrelated-project', CONNET_PG_PRIVATE_DIR: '/must-not-use-secret-directory', COMPOSE_PROJECT_NAME: 'another-project', DOCKER_HOST: 'unix:///must-not-use.sock' };
  const before = { ...inherited }, text = await compose(config, ['config', '--format', 'json'], inherited), model = JSON.parse(text);
  assert.deepEqual(inherited, before, 'The caller environment is not mutated');
  assert.equal(model.name, config.project); assert.equal(model.services.postgres.container_name, `${config.project}-server`); assert.equal(model.services.postgres.image, config.image);
  assert.deepEqual(model.services.postgres.ports.map((port: { host_ip: string; published: string; target: number }) => [port.host_ip, port.published, port.target]), [['127.0.0.1', String(config.port), 5432]]);
  assert.equal(model.volumes.data.name, `${config.project}-data`);
  for (const kind of ['admin', 'migration', 'application', 'backup']) assert.equal(model.secrets[`${kind}-password`].file, `${config.privateDir}/${kind}-password`);
  assert.equal(text.includes('/must-not-use-secret-directory'), false); assert.equal(text.includes('unrelated-project'), false);
});
test('status compares actual container image IDs/references and resource identity, reporting a real-inspect mismatch instead of echoing expectations', async () => {
  const file = process.env.M1_PG_RUNTIME_FILE; if (!file) throw new Error('A private isolated runtime configuration is required');
  const config = await readRuntime(file), inspected = JSON.parse(await docker(['inspect', `${config.project}-server`, '--format', '{{json .}}'])) as ContainerObservation;
  const imageId = (await docker(['image', 'inspect', config.image, '--format', '{{.Id}}'])).trim();
  assert.equal(runtimeObservation(config, inspected, imageId).matches, true);
  const changed = structuredClone(inspected); changed.Config.Image = 'postgres:18.6-trixie'; changed.Image = `sha256:${'0'.repeat(64)}`;
  const report = runtimeObservation(config, changed, imageId); assert.equal(report.matches, false);
  assert.equal(report.expected.image, config.image); assert.equal(report.observed.image, 'postgres:18.6-trixie');
  assert(report.mismatches.includes('image')); assert(report.mismatches.includes('imageId'));
});
