import { extension } from '../browser/api';
import { CLAUDE_ORIGINS } from '../platforms';

const CLAUDE_SCRIPT_ID = 'ai-notebook-claude';
/**
 * claude.ai is an optional host, so its content script cannot be declared in the
 * manifest without a new install-time warning. Register it only while granted.
 */
export async function syncClaudeContentScript(): Promise<boolean> {
  const granted = await Promise.resolve()
    .then(() => extension.permissions.contains({ origins: CLAUDE_ORIGINS }))
    .catch(() => false);
  const registered = await Promise.resolve()
    .then(() => extension.scripting.getRegisteredContentScripts({ ids: [CLAUDE_SCRIPT_ID] }))
    .catch(() => [] as chrome.scripting.RegisteredContentScript[]);
  if (granted && !registered.length) {
    await extension.scripting.registerContentScripts([
      {
        id: CLAUDE_SCRIPT_ID,
        matches: CLAUDE_ORIGINS,
        js: ['content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
    // Tabs opened before the grant have no content script yet. The script
    // guards against running twice, so a later notebook injection is harmless.
    const tabs = await Promise.resolve()
      .then(() => extension.tabs.query({ url: CLAUDE_ORIGINS }))
      .catch(() => [] as chrome.tabs.Tab[]);
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) =>
          extension.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] }),
        ),
    );
  }
  if (!granted && registered.length)
    await extension.scripting.unregisterContentScripts({ ids: [CLAUDE_SCRIPT_ID] });
  return granted;
}
export function watchOptionalPlatforms() {
  const sync = () => void syncClaudeContentScript().catch(console.error);
  extension.permissions?.onAdded?.addListener(sync);
  extension.permissions?.onRemoved?.addListener(sync);
  sync();
}
