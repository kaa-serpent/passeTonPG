import { DatabaseSync, backup } from "node:sqlite";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

const sourceArg = process.argv[2];
if (!sourceArg || process.argv[3] !== "--confirm") throw new Error("Usage : node scripts/restore.mjs /app/data/backups/sauvegarde.sqlite --confirm (application arrêtée)");
const source = resolve(sourceArg);
const destination = resolve(process.env.DATABASE_PATH || "data/passetonpg.sqlite");
if (source === destination) throw new Error("La sauvegarde doit être un autre fichier que la base active.");
const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
try {
  const check = db.prepare("PRAGMA integrity_check").get();
  if (check.integrity_check !== "ok") throw new Error("La sauvegarde n’a pas passé la vérification d’intégrité.");
  await backup(db, destination);
  for (const suffix of ["-wal", "-shm"]) {
    await unlink(destination + suffix).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  console.log("Base restaurée. Vous pouvez redémarrer l’application.");
} finally { db.close(); }
