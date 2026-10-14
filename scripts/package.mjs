import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
async function collect(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(files, await collect(path.join(directory, entry.name), `${name}/`));
    else if (!entry.name.endsWith('.map'))
      files[name] = new Uint8Array(await readFile(path.join(directory, entry.name)));
  }
  return files;
}
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('packages', { recursive: true });
for (const [target, directory, suffix] of [
  ['chrome', 'dist', 'zip'],
  ['arc', 'build/arc', 'zip'],
  ['firefox', 'build/firefox', 'xpi'],
]) {
  const name = `packages/ai-notebook-${target}-${version}.${suffix}`;
  await writeFile(name, zipSync(await collect(directory), { level: 6 }));
  console.log(name);
}
