import type { Database, Notebook } from '../types';
import type { ImageBlobRecord, ImageRecord } from '../images/types';
export const DATABASE_NAME = 'ai-notebook';
export const DATABASE_VERSION = 2;
let connection: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
        db.createObjectStore('metadata');
      }
      if (event.oldVersion < 2) {
        // Images stay outside notebook records, so notebook writes stay small
        // and message.text/highlight anchors never depend on image capture.
        const images = db.createObjectStore('images', {
          keyPath: ['notebookId', 'messageId', 'index'],
        });
        images.createIndex('notebookId', 'notebookId');
        images.createIndex('hash', 'hash');
        db.createObjectStore('imageBlobs', { keyPath: 'hash' });
      }
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error ?? new Error('Could not open notebook storage.'));
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error('Close other AI Notebook views and retry the storage upgrade.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  });
  return connection;
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Notebook transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Notebook storage failed.'));
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readDatabase(): Promise<Database | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(['notebooks', 'metadata'], 'readonly');
  const done = completed(tx);
  const [values] = await Promise.all([
    Promise.all([
      result(tx.objectStore('notebooks').getAll() as IDBRequest<Notebook[]>),
      result(
        tx.objectStore('metadata').get('state') as IDBRequest<
          Omit<Database, 'notebooks'> | undefined
        >,
      ),
    ]),
    done,
  ]);
  const [notebooks, state] = values;
  return state
    ? {
        ...state,
        notebooks: notebooks.sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        ),
      }
    : undefined;
}
export async function writeDatabase(next: Database, previous?: Database): Promise<void> {
  const db = await openDatabase();
  // Notebook bodies and session metadata commit together. Request success alone
  // does not mean a write is durable: callers wait for transaction completion.
  const tx = db.transaction(['notebooks', 'metadata', 'images', 'imageBlobs'], 'readwrite');
  const done = completed(tx);
  try {
    const store = tx.objectStore('notebooks');
    const old = new Map(previous?.notebooks.map((n) => [n.id, n]) ?? []);
    for (const notebook of next.notebooks) {
      if (JSON.stringify(notebook) !== JSON.stringify(old.get(notebook.id))) store.put(notebook);
      old.delete(notebook.id);
    }
    for (const id of old.keys()) {
      store.delete(id);
      // A deleted notebook's images go in the same transaction as its record.
      void deleteNotebookImages(tx, id).catch(() => tx.abort());
    }
    const { notebooks: _notebooks, ...state } = next;
    tx.objectStore('metadata').put(state, 'state');
  } catch (error) {
    tx.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}
async function deleteNotebookImages(tx: IDBTransaction, notebookId: string) {
  const images = tx.objectStore('images');
  const records = await result(
    images.index('notebookId').getAll(notebookId) as IDBRequest<ImageRecord[]>,
  );
  for (const record of records) images.delete([record.notebookId, record.messageId, record.index]);
  await removeOrphans(
    tx,
    records.map((record) => record.hash),
  );
}
/** Delete blobs that no image record references any more. Same transaction. */
async function removeOrphans(tx: IDBTransaction, hashes: (string | undefined)[]) {
  const index = tx.objectStore('images').index('hash');
  for (const hash of new Set(hashes.filter((value): value is string => !!value)))
    if (!(await result(index.count(hash)))) tx.objectStore('imageBlobs').delete(hash);
}
export type ImageKey = Pick<ImageRecord, 'notebookId' | 'messageId' | 'index'>;
const keyOf = (key: ImageKey) => [key.notebookId, key.messageId, key.index];
/** Store or replace one image record; a blob is written once per content hash. */
export async function putImage(record: ImageRecord, blob?: ImageBlobRecord): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['images', 'imageBlobs'], 'readwrite');
  const done = completed(tx);
  try {
    const images = tx.objectStore('images');
    const blobs = tx.objectStore('imageBlobs');
    const previous = await result(images.get(keyOf(record)) as IDBRequest<ImageRecord | undefined>);
    if (blob && blob.hash === record.hash && !(await result(blobs.count(blob.hash))))
      blobs.put(blob);
    if (record.status === 'saved' && (!record.hash || !(await result(blobs.count(record.hash)))))
      throw new Error('Image data is missing.');
    images.put(record);
    if (previous?.hash !== record.hash) await removeOrphans(tx, [previous?.hash]);
  } catch (error) {
    tx.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}
/** Mark an image removed, so background capture does not fetch it again. */
export async function removeImage(key: ImageKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['images', 'imageBlobs'], 'readwrite');
  const done = completed(tx);
  const images = tx.objectStore('images');
  const previous = await result(images.get(keyOf(key)) as IDBRequest<ImageRecord | undefined>);
  if (previous) {
    const { hash, mime: _mime, width: _width, height: _height, bytes: _bytes, ...rest } = previous;
    images.put({ ...rest, status: 'removed' } satisfies ImageRecord);
    await removeOrphans(tx, [hash]);
  }
  await done;
}
export async function listImages(notebookId: string): Promise<ImageRecord[]> {
  const db = await openDatabase();
  const tx = db.transaction('images', 'readonly');
  const [records] = await Promise.all([
    result(
      tx.objectStore('images').index('notebookId').getAll(notebookId) as IDBRequest<ImageRecord[]>,
    ),
    completed(tx),
  ]);
  return records.sort((a, b) => a.messageId.localeCompare(b.messageId) || a.index - b.index);
}
export async function getImageBlob(hash: string): Promise<ImageBlobRecord | undefined> {
  const db = await openDatabase();
  const tx = db.transaction('imageBlobs', 'readonly');
  const [record] = await Promise.all([
    result(tx.objectStore('imageBlobs').get(hash) as IDBRequest<ImageBlobRecord | undefined>),
    completed(tx),
  ]);
  return record;
}
/** Import images for notebooks that were added in the same import. */
export async function importImages(
  records: ImageRecord[],
  blobs: ImageBlobRecord[],
): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['images', 'imageBlobs'], 'readwrite');
  const done = completed(tx);
  const store = tx.objectStore('imageBlobs');
  for (const blob of blobs) store.put(blob);
  for (const record of records) tx.objectStore('images').put(record);
  await done;
}
export async function closeDatabase(): Promise<void> {
  if (connection) (await connection).close();
  connection = undefined;
}
