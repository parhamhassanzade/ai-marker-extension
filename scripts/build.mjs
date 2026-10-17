import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
await build();
// One classic IIFE can run in Chromium workers and Firefox event backgrounds.
for (const [entry, name] of [
  ['src/background/serviceWorker.ts', 'background'],
  ['src/content/index.ts', 'content'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      emptyOutDir: false,
      lib: { entry, name: 'AINotebook', formats: ['iife'], fileName: () => `${name}.js` },
      minify: true,
      sourcemap: true,
    },
  });
}
const chromeManifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await writeFile('dist/manifest.json', JSON.stringify(chromeManifest, null, 2) + '\n');
// Remove the retired generated Arc target; dist serves every Chromium browser.
await rm('build/arc', { recursive: true, force: true });
// Keep dist as the existing Chrome install path. Other distributions live beside
// it, so loading dist never accidentally includes another complete extension.
for (const target of ['firefox']) {
  const directory = `build/${target}`;
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp('dist', directory, { recursive: true, force: true });
  const manifest = structuredClone(chromeManifest);
  manifest.permissions = manifest.permissions.filter((p) => p !== 'sidePanel');
  delete manifest.side_panel;
  if (target === 'firefox') {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ['background.js'] };
    manifest.sidebar_action = {
      default_title: 'AI Notebook',
      default_panel: 'sidepanel.html',
      default_icon: manifest.action.default_icon,
      open_at_install: false,
    };
    manifest.browser_specific_settings = {
      gecko_android: { strict_min_version: '142.0' },
      gecko: {
        id: 'ai-notebook@ai-marker.local',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
  }
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
}
