import { extension } from './api';

export const SURFACE_PREFERENCE_KEY = 'aiNotebook.surface';
export type SurfacePreference = 'auto' | 'side-panel' | 'window';
export type NotebookSurface = 'side-panel' | 'window';
export function surfacePreference(value: unknown): SurfacePreference {
  return value === 'side-panel' || value === 'window' ? value : 'auto';
}
export async function getSurfacePreference(): Promise<SurfacePreference> {
  return surfacePreference(
    (await extension.storage.local.get(SURFACE_PREFERENCE_KEY))[SURFACE_PREFERENCE_KEY],
  );
}
