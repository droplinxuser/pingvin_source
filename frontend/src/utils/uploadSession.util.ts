/**
 * IndexedDB-backed upload manifests. Only metadata is stored: the file bytes
 * stay on the visitor's device. A resumed upload therefore requires the same
 * file to be selected again; completed chunk indexes tell the client where to
 * continue.
 */
const DB_NAME = "dropmb-uploads";
const DB_VERSION = 1;
const STORE = "sessions";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 40;

export type UploadSession = {
  key: string;
  shareId: string;
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  completedChunks: number;
  updatedAt: number;
};

const sessionKey = (shareId: string, fileId: string) => `${shareId}:${fileId}`;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(
  mode: "readonly" | "readwrite",
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

export async function saveUploadSession(
  session: Omit<UploadSession, "key" | "updatedAt">,
): Promise<void> {
  try {
    await withStore("readwrite", (store) =>
      store.put({
        ...session,
        key: sessionKey(session.shareId, session.fileId),
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // Resumability is best-effort; an unavailable/blocked IndexedDB must not
    // stop an upload.
  }
}

export async function updateUploadProgress(
  shareId: string,
  fileId: string,
  completedChunks: number,
): Promise<void> {
  try {
    const key = sessionKey(shareId, fileId);
    const existing = await withStore<UploadSession | undefined>(
      "readonly",
      (store) => store.get(key),
    );
    if (!existing) return;
    await withStore("readwrite", (store) =>
      store.put({ ...existing, completedChunks, updatedAt: Date.now() }),
    );
  } catch {
    // Best-effort.
  }
}

export async function removeUploadSession(
  shareId: string,
  fileId: string,
): Promise<void> {
  try {
    await withStore("readwrite", (store) =>
      store.delete(sessionKey(shareId, fileId)),
    );
  } catch {
    // Best-effort.
  }
}

export async function removeSessionsForShare(shareId: string): Promise<void> {
  try {
    const sessions = await withStore<UploadSession[]>("readonly", (store) =>
      store.getAll(),
    );
    await Promise.all(
      sessions
        .filter((session) => session.shareId === shareId)
        .map((session) =>
          withStore("readwrite", (store) => store.delete(session.key)),
        ),
    );
  } catch {
    // Best-effort.
  }
}

export async function listUploadSessions(): Promise<UploadSession[]> {
  try {
    const sessions = await withStore<UploadSession[]>("readonly", (store) =>
      store.getAll(),
    );
    const cutoff = Date.now() - MAX_AGE_MS;
    const live = sessions
      .filter((session) => session.updatedAt >= cutoff)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    return live;
  } catch {
    return [];
  }
}

export function matchesUploadSession(
  session: UploadSession,
  file: File,
): boolean {
  return session.name === file.name && session.size === file.size;
}
