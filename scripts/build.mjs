import { build } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
await build();
// Content scripts cannot use static ES imports. Bundle independently as an IIFE.
for (const [entry, name, format] of [
  ['src/background/serviceWorker.ts', 'background', 'es'],
  ['src/content/index.ts', 'content', 'iife'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      emptyOutDir: false,
      lib: { entry, name: 'AINotebook', formats: [format], fileName: () => `${name}.js` },
      minify: true,
      sourcemap: true,
    },
  });
}
await mkdir('dist', { recursive: true });
await copyFile('manifest.json', 'dist/manifest.json');
