export type PersistenceStatus = 'not-needed' | 'unsupported' | 'granted' | 'denied' | 'failed';
let attempt: Promise<PersistenceStatus> | undefined;

// Call from the extension page, never the ChatGPT content script: persistence is
// origin-scoped. Keep this best effort and separate from the worker's writes.
// Cache one attempt per page lifetime, including denial, to avoid repeated prompts
// on every streamed update. Reopening the notebook allows another attempt.
export function requestNotebookPersistence(notebookCount: number): Promise<PersistenceStatus> {
  if (notebookCount <= 0) return Promise.resolve('not-needed');
  attempt ??= (async (): Promise<PersistenceStatus> => {
    try {
      const manager = navigator.storage;
      if (typeof manager?.persist !== 'function') return 'unsupported';
      if (typeof manager.persisted === 'function' && (await manager.persisted())) return 'granted';
      return (await manager.persist()) ? 'granted' : 'denied';
    } catch {
      // Permission restrictions, private browsing, or unavailable storage must
      // not turn a successfully committed notebook into a failed user action.
      return 'failed';
    }
  })();
  return attempt;
}
