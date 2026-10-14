import { extension } from '../browser/api';
export type Theme = 'light' | 'dark';
export const settings = {
  async getTheme(): Promise<Theme | undefined> {
    const data = await extension.storage.local.get('aiNotebook.theme');
    return data['aiNotebook.theme'] === 'dark' || data['aiNotebook.theme'] === 'light'
      ? data['aiNotebook.theme']
      : undefined;
  },
  async setTheme(theme: Theme) {
    await extension.storage.local.set({ 'aiNotebook.theme': theme });
  },
};
