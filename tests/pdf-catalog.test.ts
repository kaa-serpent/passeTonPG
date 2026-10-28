import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store, modelSchema } from "../src/lib/server/store";
import { seedCatalog } from "../scripts/seed-catalog.mjs";
import { importPdfCatalog } from "../scripts/import-pdf-catalog.mjs";
import pdf from "../scripts/catalog/pdf-profiles.json";

test("PDF import corrects original codes, keeps Excel provenance and preserves project snapshots", () => {
  const store = new Store(":memory:");
  try {
    seedCatalog(store.db);
    const before = store.listModels();
    const titan = before.find(model => model.brand === "KWIKSET")!;
    const user = store.register({ username: "TestPDF", password: "test-pdf-password" });
    const project = store.saveProject(user.id, { project: {
      id: randomUUID(), name: "Ancien projet", description: "", cylinderType: "paracentrique", pinCount: 5,
      min: 0, max: 6, macs: 4, modelId: titan.id, modelVersion: 1, entries: [], revision: 0, updatedAt: "",
    } }, true);
    const result = importPdfCatalog(store.db);
    assert.equal(result.created.length, 14);
    assert.equal(result.updated.length, 11);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.deferred, 23);
    const models = store.listModels();
    assert.equal(models.length, 53);
    const updatedTitan = store.getModel(titan.id);
    assert.equal(updatedTitan.name, "Titan US");
    assert.equal(updatedTitan.version, 2);
    assert.equal(updatedTitan.min, 1);
    assert.equal(updatedTitan.max, 7);
    assert.equal(updatedTitan.macs, 4);
    assert.deepEqual(updatedTitan.measurementSource, titan.measurementSource);
    assert.deepEqual(store.getProject(user.id, project.id), project);
    assert.equal(updatedTitan.pdfSource!.page, 8);
    assert.equal(updatedTitan.pdfSource!.firstPin, 0.097);
    assert.ok(!updatedTitan.pendingFields.includes("min"));
    for (const model of models.filter(model => model.pdfSource)) {
      const { brand, name, cylinderType, pinCount, min, max, macs } = model;
      assert.equal(modelSchema.safeParse({ brand, name, cylinderType, pinCount, min, max, macs }).success, true);
      assert.equal(pinCount, 5);
      assert.equal(model.verified, false);
      assert.ok(model.pendingFields.includes("pinCount"));
      assert.equal(model.pdfSource!.codes.length, model.pdfSource!.depths.length);
    }
    const sargent = models.find(model => model.brand === "SARGENT")!;
    assert.equal(sargent.pdfSource!.codes.at(-1), 0);
    assert.equal(sargent.pdfSource!.depths.at(-1), 0.148);
    assert.equal(sargent.macs, null);
    assert.equal(sargent.measurementSource!.macs, 7);
    assert.ok(sargent.pendingFields.includes("macs"));
    assert.equal(models.filter(model => model.brand === "WESLOCK").length, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM catalog_import_changes").get()!.n, 25);
    const touchedIds = new Set(models.filter(model => model.pdfSource).map(model => model.id));
    for (const old of before.filter(model => !touchedIds.has(model.id))) assert.deepEqual(store.getModel(old.id), old);
    assert.equal(new Set([...pdf.profiles, ...pdf.deferred].map(item => `${item.page}:${item.card}`)).size, 47);
  } finally { store.close(); }
});

test("PDF import dry run, repeat import, Excel re-import and corrected contributions remain safe", () => {
  const store = new Store(":memory:");
  try {
    seedCatalog(store.db);
    const before = store.listModels();
    assert.equal(importPdfCatalog(store.db, { dryRun: true }).updated.length, 11);
    assert.deepEqual(store.listModels(), before);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='catalog_import_changes'").get(), undefined);
    const schlage = before.find(model => model.brand === "SCHLAGE")!;
    const corrected = store.patchModel(schlage.id, { pinCount: 6, verify: true });
    assert.equal(importPdfCatalog(store.db).conflicts.length, 1);
    assert.deepEqual(store.getModel(schlage.id), corrected);
    const imported = store.listModels().find(model => model.brand === "KWIKSET" && model.pdfSource)!;
    const modified = store.patchModel(imported.id, { name: "Titan corrigé", pinCount: 6 });
    const again = importPdfCatalog(store.db);
    assert.equal(again.created.length, 0);
    assert.equal(again.updated.length, 0);
    assert.equal(again.existing.length, 24);
    assert.equal(again.conflicts.length, 1);
    assert.deepEqual(store.getModel(modified.id), modified);
    assert.equal(seedCatalog(store.db).inserted, 0);
  } finally { store.close(); }
});

test("PDF-first import remains compatible with a later Excel import", () => {
  const store = new Store(":memory:");
  try {
    assert.equal(importPdfCatalog(store.db).created.length, 25);
    assert.equal(store.listModels().length, 25);
    assert.equal(seedCatalog(store.db).inserted, 28);
    assert.equal(store.listModels().length, 53);
  } finally { store.close(); }
});

test("PDF import rolls back all model, source and audit changes if a write fails", () => {
  const store = new Store(":memory:");
  try {
    seedCatalog(store.db);
    const before = store.listModels();
    store.db.exec(`CREATE TRIGGER fail_pdf BEFORE INSERT ON models
      WHEN json_extract(NEW.data,'$.brand')='HUDSON'
      BEGIN SELECT RAISE(ABORT,'test rollback'); END;`);
    assert.throws(() => importPdfCatalog(store.db), /test rollback/);
    assert.deepEqual(store.listModels(), before);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM catalog_sources").get()!.n, 41);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='catalog_import_changes'").get(), undefined);
  } finally { store.close(); }
});
