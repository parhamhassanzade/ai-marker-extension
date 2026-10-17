import { useEffect, useState } from 'react';
import { extension } from '../browser/api';
import { currentSourceTab } from './connection';
import {
  getSurfacePreference,
  surfacePreference,
  SURFACE_PREFERENCE_KEY,
  type SurfacePreference,
} from '../browser/surfacePreference';

export function SurfaceSettings() {
  const [preference, setPreference] = useState<SurfacePreference>('auto');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    void getSurfacePreference()
      .then((value) => {
        if (active) setPreference(value);
      })
      .catch(() => undefined);
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SURFACE_PREFERENCE_KEY in changes)
        setPreference(surfacePreference(changes[SURFACE_PREFERENCE_KEY]?.newValue));
    };
    extension.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      extension.storage.onChanged.removeListener(changed);
    };
  }, []);
  return (
    <details className="notebook-settings">
      <summary>Notebook settings</summary>
      <label htmlFor="notebook-surface">Open notebook in:</label>
      <select
        id="notebook-surface"
        value={preference}
        onChange={async (event) => {
          const value = surfacePreference(event.target.value);
          try {
            const result = await extension.runtime.sendMessage({
              type: 'setNotebookSurface',
              value,
            });
            if (!result.ok) throw new Error(result.error);
            setPreference(value);
            setStatus('Saved. Applies the next time you open the notebook.');
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Could not save setting.');
          }
        }}
      >
        <option value="auto">Automatic</option>
        <option value="side-panel">Side panel</option>
        <option value="window">Separate window</option>
      </select>
      <p>If the side panel cannot open, a separate window opens instead.</p>
      <button
        onClick={async () => {
          try {
            const tab = await currentSourceTab();
            const result = await extension.runtime.sendMessage({
              type: 'openNotebookSurface',
              tabId: tab.id,
              windowId: tab.windowId,
            });
            if (!result.ok) throw new Error(result.error);
            setStatus(
              result.surface === 'window'
                ? 'Opened in a separate window.'
                : 'Opened in the side panel.',
            );
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Could not open notebook.');
          }
        }}
      >
        Open notebook
      </button>
      <p role="status">{status}</p>
    </details>
  );
}
