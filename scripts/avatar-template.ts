/** Optional offline helper: node scripts/avatar-template.ts --out /absolute/new-directory
 * Copies public authoring materials only. No model, installation, HTTP, credential or world write.
 * The destination must not exist; editing the copied sample never changes a resident's appearance.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../apps/web/public/avatar-authoring/v1/', import.meta.url));
export const AUTHORING_FILES = ['prompt.json', 'template.json', 'sample.manifest.json', 'idle.png', 'walk.png'] as const;

export async function copyAvatarAuthoringTemplate(destination: string): Promise<{ files: number; destination: string }> {
  if (!isAbsolute(destination) || resolve(destination) === resolve(source)) throw new Error('absolute_new_destination_required');
  // Read the whole kit before creating the destination. Missing committed assets fail closed.
  const files = await Promise.all(AUTHORING_FILES.map(async name => ({ name, bytes: await readFile(join(source, name)) })));
  await mkdir(destination, { mode: 0o700 });
  for (const { name, bytes } of files) await writeFile(join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
  return { files: files.length, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) {
    console.error('Usage: node scripts/avatar-template.ts --out /absolute/new-directory');
    process.exitCode = 1;
  } else {
    copyAvatarAuthoringTemplate(args[1]).then(result => console.info(JSON.stringify(result))).catch(() => {
      console.error('avatar_template_copy_failed; destination must be new and all public template files must exist');
      process.exitCode = 1;
    });
  }
}
