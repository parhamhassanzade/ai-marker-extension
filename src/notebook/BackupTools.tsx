import { useState } from 'react';
import { extension } from '../browser/api';
import { decodeNotebookArchive, type NotebookArchive, type ArchiveBlob } from '../storage/archive';
import { importImages } from '../storage/indexedDB';
import { exportBackup } from './downloads';
import type { Database } from '../types';

export function BackupTools({ db, onImported }: { db: Database; onImported(db: Database): void }) {
  const [pending, setPending] = useState<{ archive: NotebookArchive; blobs: ArchiveBlob[] }>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = new Set(db.notebooks.map((n) => n.id));
  const fresh = pending?.archive.database.notebooks.filter((n) => !existing.has(n.id)) ?? [];
  return (
    <details className="notebook-settings backup-tools">
      <summary>Backup</summary>
      <p>A backup is a ZIP file with every notebook, highlight, note, and saved image.</p>
      <button
        className="secondary-button"
        disabled={busy || !db.notebooks.length}
        onClick={() => {
          setBusy(true);
          setStatus('');
          exportBackup(db)
            .then(() => setStatus('Backup exported.'))
            .catch((error: Error) => setStatus(error.message))
            .finally(() => setBusy(false));
        }}
      >
        Export backup
      </button>
      <label className="file-button">
        Import backup
        <input
          type="file"
          accept=".zip,.json,application/zip,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setStatus('');
            setPending(undefined);
            file
              .arrayBuffer()
              .then((buffer) => decodeNotebookArchive(new Uint8Array(buffer)))
              .then(setPending)
              .catch((error: Error) => setStatus(error.message));
          }}
        />
      </label>
      {pending && (
        <div className="confirm" role="alert">
          <p>
            {fresh.length} of {pending.archive.database.notebooks.length} notebooks will be added
            {pending.archive.images.length
              ? ` with ${pending.archive.images.filter((i) => !existing.has(i.notebookId) && i.status === 'saved').length} images`
              : ''}
            . Notebooks already in your library are skipped. Imported notebooks start paused.
          </p>
          <button className="text-button" onClick={() => setPending(undefined)}>
            Cancel
          </button>
          <button
            className="text-button"
            disabled={busy || !fresh.length}
            onClick={() => {
              setBusy(true);
              const ids = new Set(fresh.map((n) => n.id));
              const images = pending.archive.images.filter((i) => ids.has(i.notebookId));
              const hashes = new Set(images.map((i) => i.hash));
              // Content-addressed blobs first; the worker commits the records.
              importImages(
                [],
                pending.blobs
                  .filter((blob) => hashes.has(blob.hash))
                  .map((blob) => ({
                    hash: blob.hash,
                    mime: blob.mime,
                    bytes: blob.bytes.length,
                    blob: new Blob([blob.bytes as Uint8Array<ArrayBuffer>], { type: blob.mime }),
                  })),
              )
                .then(() =>
                  extension.runtime.sendMessage({
                    type: 'importBackup',
                    // Imported notebooks start paused, so no active references travel.
                    database: {
                      version: 1,
                      notebooks: fresh,
                      activeByConversation: {},
                      pausedConversations: [],
                    },
                    images,
                  }),
                )
                .then(
                  (result: { ok: boolean; data?: Database; imported?: number; error?: string }) => {
                    if (!result?.ok || !result.data)
                      throw new Error(result?.error || 'Import failed.');
                    onImported(result.data);
                    setPending(undefined);
                    setStatus(`Imported ${result.imported} notebooks.`);
                  },
                )
                .catch((error: Error) => setStatus(error.message))
                .finally(() => setBusy(false));
            }}
          >
            Import
          </button>
        </div>
      )}
      <p role="status">{status}</p>
    </details>
  );
}
