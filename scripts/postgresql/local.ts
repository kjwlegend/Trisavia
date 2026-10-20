import { pathToFileURL } from 'node:url';
import { checkedImage, checkedProject, compose, docker, dockerContext, ensureAvailablePort, imageTag, initializeRuntime, readRuntime } from './runtime.ts';

export async function local(args: string[]): Promise<unknown> {
  const [action, file, ...extra] = args;
  if (action === 'pull' && file === undefined) {
    await docker(['pull', imageTag], { output: true });
    const images = JSON.parse(await docker(['image', 'inspect', imageTag, '--format', '{{json .RepoDigests}}'])) as string[];
    const digest = images.find(value => /^postgres@sha256:[a-f0-9]{64}$/.test(value)); if (!digest) throw new Error('Pulled image has no official PostgreSQL RepoDigest');
    return { image: checkedImage(`${imageTag}@${digest.split('@')[1]}`), context: dockerContext };
  }
  if (action === 'init' && file && extra.length === 3) {
    const [project, port, image] = extra; if (!project || !port || !image) throw new Error('Missing explicit runtime initialization arguments');
    return { privateRuntime: await initializeRuntime(file, checkedProject(project), Number(port), image) };
  }
  if (!file || extra.length) throw new Error('Usage: local.ts pull | init NEW_PRIVATE_DIR PROJECT PORT PINNED_IMAGE | up|status|stop RUNTIME_JSON');
  const config = await readRuntime(file);
  if (action === 'up') { await ensureAvailablePort(config.port); await compose(config, ['up', '-d', '--wait', '--wait-timeout', '90']); }
  else if (action === 'stop') { await compose(config, ['stop', '--timeout', '60']); }
  else if (action !== 'status') throw new Error('Unknown local runtime action');
  const containers = JSON.parse(await docker(['inspect', `${config.project}-server`, '--format', '{{json .}}'])) as Record<string, any>;
  return { context: dockerContext, project: config.project, image: config.image, running: containers.State.Running,
    health: containers.State.Health?.Status ?? null, ports: containers.NetworkSettings.Ports,
    mounts: containers.Mounts.map((mount: Record<string, unknown>) => ({ type: mount.Type, name: mount.Name, destination: mount.Destination, writable: mount.RW })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  local(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(() => { process.stderr.write('postgresql_local_failed: runtime operation did not complete; no secret configuration is printed\n'); process.exitCode = 1; });
}
