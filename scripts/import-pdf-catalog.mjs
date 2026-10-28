import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const pdfCatalog = JSON.parse(readFileSync(new URL("./catalog/pdf-profiles.json", import.meta.url), "utf8"));
const excelProfiles = JSON.parse(readFileSync(new URL("./catalog/base-profiles.json", import.meta.url), "utf8"));
const normalize = value => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]/gu, "");

export function importPdfCatalog(db, { dryRun = false } = {}) {
  const result = { created: [], updated: [], existing: [], conflicts: [], deferred: pdfCatalog.deferred.length };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS catalog_sources (source_key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS catalog_import_changes (import_key TEXT PRIMARY KEY, model_id TEXT NOT NULL,
        previous_data TEXT, imported_data TEXT NOT NULL, imported_at TEXT NOT NULL)`);
    const sourceInsert = db.prepare("INSERT INTO catalog_sources(source_key,data) VALUES (?,?) ON CONFLICT(source_key) DO NOTHING");
    for (const record of [...pdfCatalog.profiles, ...pdfCatalog.deferred]) {
      const key = `pdf:${pdfCatalog.sha256}:${record.page}:${record.card}:${record.brand || "deferred"}`;
      sourceInsert.run(key, JSON.stringify({ file: pdfCatalog.file, sha256: pdfCatalog.sha256, unit: pdfCatalog.unit, ...record }));
      if (record.reason) continue;
      if (db.prepare("SELECT model_id FROM catalog_import_changes WHERE import_key=?").get(key)) {
        result.existing.push(record.label); continue;
      }
      const { codes, depths } = record;
      if (!codes?.length || codes.length !== depths?.length || new Set(codes).size !== codes.length ||
        codes.some(code => !Number.isInteger(code) || code < 0 || code > 9) ||
        depths.some(depth => !Number.isFinite(depth) || depth <= 0)) throw new Error(`Mesures PDF invalides : ${record.label}`);
      const min = Math.min(...codes), max = Math.max(...codes);
      if (max - min + 1 !== codes.length) throw new Error(`Plage discontinue : ${record.label}`);
      let old, excelSource;
      if (record.excelKey) {
        const excel = excelProfiles.find(profile => profile.key === record.excelKey);
        if (!excel || excel.source.depths.length !== depths.length || excel.source.depths.some((value, index) => Math.abs(value - depths[index]) > 1e-8)) {
          throw new Error(`Correspondance Excel non confirmée : ${record.label}`);
        }
        excelSource = excel.source;
        const row = db.prepare("SELECT data FROM models WHERE json_extract(data,'$.measurementSource.sha256')=? AND json_extract(data,'$.measurementSource.row')=? AND json_extract(data,'$.measurementSource.sheet')=?")
          .get(excel.source.sha256, excel.source.row, excel.source.sheet);
        old = row ? JSON.parse(row.data) : undefined;
        // Never replace an administrator's corrections or an already validated contribution.
        if (old && (old.version !== 1 || old.verified || old.pdfSource)) {
          result.conflicts.push(`${record.brand} · ${record.name} : fiche déjà modifiée`); continue;
        }
      }
      const collision = db.prepare("SELECT id FROM models WHERE brand_key=? AND name_key=?").get(normalize(record.brand), normalize(record.name));
      if (collision && collision.id !== old?.id) {
        result.conflicts.push(`${record.brand} · ${record.name} : nom déjà utilisé`); continue;
      }
      const brand = old?.brand ?? (() => {
        const row = db.prepare("SELECT data FROM models WHERE brand_key=? LIMIT 1").get(normalize(record.brand));
        return row ? JSON.parse(row.data).brand : record.brand;
      })();
      const macs = record.disableMacs ? null : old ? old.macs : excelSource?.macs ?? null;
      const model = {
        ...old, id: old?.id ?? randomUUID(), brand, name: record.name,
        cylinderType: "paracentrique", pinCount: old?.pinCount ?? 5, min, max, macs,
        version: (old?.version ?? 0) + 1, verified: false,
        pendingFields: ["pinCount", ...(macs === null ? ["macs"] : [])],
        measurementSource: old?.measurementSource ?? excelSource,
        pdfSource: {
          file: pdfCatalog.file, sha256: pdfCatalog.sha256, page: record.page, card: record.card,
          label: record.label, unit: "inch", codes, depths, firstPin: record.firstPin,
          pinSpacing: record.pinSpacing, readDirection: record.readDirection, notes: record.notes,
        },
      };
      if (old) db.prepare("UPDATE models SET name_key=?,data=? WHERE id=?").run(normalize(model.name), JSON.stringify(model), model.id);
      else db.prepare("INSERT INTO models(id,brand_key,name_key,data) VALUES (?,?,?,?)").run(model.id, normalize(brand), normalize(model.name), JSON.stringify(model));
      db.prepare("INSERT INTO catalog_import_changes(import_key,model_id,previous_data,imported_data,imported_at) VALUES (?,?,?,?,?)")
        .run(key, model.id, old ? JSON.stringify(old) : null, JSON.stringify(model), new Date().toISOString());
      result[old ? "updated" : "created"].push(`${brand} · ${model.name}`);
    }
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const db = new DatabaseSync(process.env.DATABASE_PATH || "data/passetonpg.sqlite", { timeout: 5000 });
  try { console.log(JSON.stringify(importPdfCatalog(db, { dryRun: process.argv.includes("--dry-run") }), null, 2)); }
  finally { db.close(); }
}
