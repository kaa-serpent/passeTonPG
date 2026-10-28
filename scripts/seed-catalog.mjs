import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const baseProfiles = JSON.parse(readFileSync(new URL("./catalog/base-profiles.json", import.meta.url), "utf8"));
const normalize = value => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]/gu, "");

/** Import only representable profiles; preserve existing contributions and source measurements. */
export function seedCatalog(db) {
  const result = { inserted: 0, existing: 0, deferred: [] };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS catalog_sources (source_key TEXT PRIMARY KEY, data TEXT NOT NULL)");
    const source = db.prepare("INSERT INTO catalog_sources(source_key,data) VALUES (?,?) ON CONFLICT(source_key) DO NOTHING");
    const insert = db.prepare("INSERT INTO models(id,brand_key,name_key,data) VALUES (?,?,?,?) ON CONFLICT(brand_key,name_key) DO NOTHING");
    for (const profile of baseProfiles) {
      source.run(profile.key, JSON.stringify(profile));
      if (profile.deferredReason) {
        result.deferred.push({ brand: profile.brand, reason: profile.deferredReason });
        continue;
      }
      const imported = db.prepare("SELECT id FROM models WHERE json_extract(data, '$.measurementSource.sha256')=? AND json_extract(data, '$.measurementSource.row')=? AND json_extract(data, '$.measurementSource.sheet')=?").get(profile.source.sha256, profile.source.row, profile.source.sheet);
      if (imported) { result.existing++; continue; }
      const depths = profile.source.depths;
      if (!depths.length || depths.length > 10 || depths.some(value => !Number.isFinite(value))) throw new Error(`Profondeurs invalides : ${profile.key}`);
      const rawMacs = profile.source.macs;
      const macs = Number.isInteger(rawMacs) && rawMacs >= 0 && rawMacs <= 9 ? rawMacs : null;
      const brandKey = normalize(profile.brand);
      const existingBrand = db.prepare("SELECT data FROM models WHERE brand_key=? LIMIT 1").get(brandKey);
      const model = {
        id: randomUUID(), brand: existingBrand ? JSON.parse(existingBrand.data).brand : profile.brand,
        name: profile.name, cylinderType: "paracentrique", pinCount: 5,
        min: 0, max: depths.length - 1, macs, version: 1, verified: false,
        pendingFields: ["pinCount", "min", "max", ...(macs === null ? ["macs"] : [])],
        measurementSource: profile.source,
      };
      const inserted = insert.run(model.id, brandKey, normalize(model.name), JSON.stringify(model)).changes;
      if (inserted) result.inserted++; else result.existing++;
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const db = new DatabaseSync(process.env.DATABASE_PATH || "data/passetonpg.sqlite", { timeout: 5000 });
  try { console.log(JSON.stringify(seedCatalog(db), null, 2)); }
  finally { db.close(); }
}
