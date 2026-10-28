import { DatabaseSync, backup } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.env.DATABASE_PATH || "data/passetonpg.sqlite");
const destination = resolve(process.argv[2] || `data/backups/passetonpg-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
if (source === destination) throw new Error("La sauvegarde doit être un autre fichier que la base active.");
await mkdir(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
try {
  await backup(db, destination);
  console.log(`Sauvegarde créée : ${destination}`);
} finally { db.close(); }
