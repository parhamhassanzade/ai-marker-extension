import type { Database, Notebook } from '../types';
export const DATABASE_NAME = 'ai-notebook';
let connection: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('notebooks', { keyPath: 'id' });
      db.createObjectStore('metadata');
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
  const tx = db.transaction(['notebooks', 'metadata'], 'readwrite');
  const done = completed(tx);
  try {
    const store = tx.objectStore('notebooks');
    const old = new Map(previous?.notebooks.map((n) => [n.id, n]) ?? []);
    for (const notebook of next.notebooks) {
      if (JSON.stringify(notebook) !== JSON.stringify(old.get(notebook.id))) store.put(notebook);
      old.delete(notebook.id);
    }
    for (const id of old.keys()) store.delete(id);
    const { notebooks: _notebooks, ...state } = next;
    tx.objectStore('metadata').put(state, 'state');
  } catch (error) {
    tx.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}
export async function closeDatabase(): Promise<void> {
  if (connection) (await connection).close();
  connection = undefined;
}
