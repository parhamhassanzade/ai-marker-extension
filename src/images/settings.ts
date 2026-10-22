import { extension } from '../browser/api';

export const IMAGE_SETTINGS_KEY = 'aiNotebook.images';
export interface ImageSettings {
  saveImages: boolean;
  includeWebImages: boolean;
  /** The first-use explanation was answered. */
  prompted: boolean;
}
export function imageSettings(value: unknown): ImageSettings {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<ImageSettings>;
  return {
    saveImages: saved.saveImages !== false,
    includeWebImages: saved.includeWebImages === true,
    prompted: saved.prompted === true,
  };
}
// Extension pages and the worker only: storage.local is limited to trusted contexts.
export async function getImageSettings(): Promise<ImageSettings> {
  return imageSettings((await extension.storage.local.get(IMAGE_SETTINGS_KEY))[IMAGE_SETTINGS_KEY]);
}
export async function setImageSettings(value: ImageSettings): Promise<void> {
  await extension.storage.local.set({ [IMAGE_SETTINGS_KEY]: imageSettings(value) });
}
