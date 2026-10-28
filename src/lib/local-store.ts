const DB_NAME = "passetonpg-local";
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}

export async function readLocal<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("records").objectStore("records").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function writeLocal(key: string, value: unknown): Promise<void> {
  return writeLocals([[key, value]]);
}

/** Commit account data and its active-user pointer together. */
export async function writeLocals(records: [string, unknown][]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");
    for (const [key, value] of records) store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Le stockage local a été interrompu."));
  });
}

export async function deleteLocal(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    transaction.objectStore("records").delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Le stockage local a été interrompu."));
  });
}

export async function clearAccountStorage(userId?: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const accountRecord = userId ? current.key === `account:${userId}` : String(current.key).startsWith("account:");
      const activePointer = current.key === "active-user" && (!userId || current.value?.id === userId);
      if (accountRecord || activePointer) current.delete();
      current.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Le stockage local a été interrompu."));
  });
}
