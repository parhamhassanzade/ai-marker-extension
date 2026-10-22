import { useEffect, useState } from 'react';
import { extension, isExtensionContext } from '../browser/api';
import {
  getImageSettings,
  imageSettings,
  IMAGE_SETTINGS_KEY,
  setImageSettings,
  type ImageSettings,
} from '../images/settings';
import { IMAGE_HOST_ORIGINS } from '../images/types';

export function useImageSettings() {
  const [value, setValue] = useState<ImageSettings>();
  useEffect(() => {
    if (!isExtensionContext()) return;
    let active = true;
    void getImageSettings()
      .then((settings) => active && setValue(settings))
      .catch(() => undefined);
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && IMAGE_SETTINGS_KEY in changes)
        setValue(imageSettings(changes[IMAGE_SETTINGS_KEY]?.newValue));
    };
    extension.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      extension.storage.onChanged.removeListener(changed);
    };
  }, []);
  return value;
}
/** Must run first in a click handler: permission prompts need the user gesture. */
function requestImageHosts(): Promise<boolean> {
  try {
    return Promise.resolve(extension.permissions.request({ origins: IMAGE_HOST_ORIGINS })).catch(
      () => false,
    );
  } catch {
    return Promise.resolve(false); // Browsers without optional permissions.
  }
}
export function ImagePrompt({ settings }: { settings: ImageSettings }) {
  const [save, setSave] = useState(true);
  return (
    <section className="image-prompt" aria-labelledby="image-prompt-title">
      <h2 id="image-prompt-title">Save images with your notebooks?</h2>
      <p>
        AI Notebook can keep generated and uploaded images next to the text, in the reader and in
        your PDF. Each image is downloaded once from the chat and stored only on this device.
        ChatGPT serves some images from <code>oaiusercontent.com</code>, so your browser may ask for
        access to that site.
      </p>
      <label>
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save
        images
      </label>
      <button
        className="secondary-button"
        onClick={() => {
          const granted = save ? requestImageHosts() : Promise.resolve(false);
          void granted.then(() =>
            setImageSettings({ ...settings, saveImages: save, prompted: true }),
          );
        }}
      >
        Continue
      </button>
    </section>
  );
}
export function ImageSettingsPanel({ settings }: { settings: ImageSettings }) {
  const [status, setStatus] = useState('');
  return (
    <details className="notebook-settings">
      <summary>Image settings</summary>
      <label>
        <input
          type="checkbox"
          checked={settings.saveImages}
          onChange={(event) => {
            const saveImages = event.target.checked;
            const granted = saveImages ? requestImageHosts() : Promise.resolve(true);
            void granted
              .then(() => setImageSettings({ ...settings, saveImages, prompted: true }))
              .then(
                () => setStatus('Saved.'),
                () => setStatus('Could not save the setting.'),
              );
          }}
        />{' '}
        Save images (generated and uploaded)
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.includeWebImages}
          disabled={!settings.saveImages}
          onChange={(event) => {
            void setImageSettings({ ...settings, includeWebImages: event.target.checked }).then(
              () => setStatus('Saved.'),
              () => setStatus('Could not save the setting.'),
            );
          }}
        />{' '}
        Include web-search images
      </label>
      <p>
        Web-search images come from other sites. When this is off, the notebook keeps a placeholder
        with the image description and a link to its page. When on, an image is saved only if its
        site allows it; no extra site access is requested.
      </p>
      <p role="status">{status}</p>
    </details>
  );
}
