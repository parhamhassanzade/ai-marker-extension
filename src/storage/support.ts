import { extension } from '../browser/api';

export const SUPPORT_STORAGE_KEY = 'aiNotebook.support.v1';
export interface SupportState {
  successfulPdfExports: number;
  dismissed: boolean;
}
export type SupportCommand =
  | { type: 'getSupportState' }
  | { type: 'recordPdfExport'; notebookId: string }
  | { type: 'dismissSupport' };
export type SupportResult = { ok: true; data: SupportState } | { ok: false; error: string };

export function supportState(value: unknown): SupportState {
  const data = value && typeof value === 'object' ? (value as Partial<SupportState>) : {};
  return {
    successfulPdfExports:
      Number.isSafeInteger(data.successfulPdfExports) && data.successfulPdfExports! >= 0
        ? data.successfulPdfExports!
        : 0,
    // Preserve a saved dismissal even if the counter is corrupt. Never reset it
    // on extension installation/update or use an extension version in its value.
    dismissed: data.dismissed === true,
  };
}
export const shouldShowSupport = (state: SupportState) =>
  state.successfulPdfExports >= 3 && !state.dismissed;
export function mergeSupportState(
  previous: SupportState | undefined,
  incoming: SupportState,
): SupportState {
  return {
    successfulPdfExports: Math.max(
      previous?.successfulPdfExports ?? 0,
      incoming.successfulPdfExports,
    ),
    dismissed: previous?.dismissed === true || incoming.dismissed,
  };
}
export function isSupportCommand(value: unknown): value is SupportCommand {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  if (value.type === 'getSupportState' || value.type === 'dismissSupport') return true;
  return (
    value.type === 'recordPdfExport' &&
    'notebookId' in value &&
    typeof value.notebookId === 'string' &&
    !!value.notebookId &&
    value.notebookId.length <= 100
  );
}
async function request(command: SupportCommand): Promise<SupportState> {
  const result = await extension.runtime.sendMessage<SupportCommand, SupportResult>(command);
  if (!result?.ok) throw new Error(result?.error || 'Could not save the support preference.');
  return result.data;
}
export const support = {
  get: () => request({ type: 'getSupportState' }),
  recordExport: (notebookId: string) => request({ type: 'recordPdfExport', notebookId }),
  dismiss: () => request({ type: 'dismissSupport' }),
  subscribe(callback: (state: SupportState) => void) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SUPPORT_STORAGE_KEY])
        callback(supportState(changes[SUPPORT_STORAGE_KEY].newValue));
    };
    extension.storage.onChanged.addListener(listener);
    return () => extension.storage.onChanged.removeListener(listener);
  },
};

// PDF errors propagate; support bookkeeping is fire-and-forget and cannot delay
// or turn a successfully saved PDF into an export error.
export async function exportWithSupport(
  exportFile: () => Promise<void>,
  recordSuccess: () => Promise<SupportState>,
  onRecorded: (state: SupportState) => void,
): Promise<void> {
  await exportFile();
  void Promise.resolve()
    .then(recordSuccess)
    .then(onRecorded)
    .catch(() => undefined);
}
