import { openNotebookWindow } from '../browser/notebookWindow';
import { extension } from '../browser/api';
export function configureNotebookSurface() {
  const manifest = extension.runtime.getManifest();
  // A manifest popup opens directly in the browser, independently of the worker.
  if (manifest.action?.default_popup) return;
  if ('side_panel' in manifest && extension.sidePanel?.setPanelBehavior) {
    void extension.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(console.error);
    return;
  }
  if ('sidebar_action' in manifest && extension.sidebarAction) {
    // Firefox requires opening the sidebar directly inside the user gesture.
    extension.action.onClicked.addListener(() => {
      void extension.sidebarAction!.open().catch(console.error);
    });
    return;
  }
  let opening: Promise<void> | undefined;
  extension.action.onClicked.addListener((tab) => {
    if (opening) return;
    opening = openNotebookWindow(tab)
      .catch(console.error)
      .finally(() => {
        opening = undefined;
      });
  });
}
