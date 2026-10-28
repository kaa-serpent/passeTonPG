import test from "node:test";
import assert from "node:assert/strict";
import { Store, modelSchema } from "../src/lib/server/store";
import { seedCatalog } from "../scripts/seed-catalog.mjs";
import baseProfiles from "../scripts/catalog/base-profiles.json";

test("Excel catalogue preserves units, variants and unsupported rows without truncation", () => {
  const store = new Store(":memory:");
  try {
    const result = seedCatalog(store.db);
    assert.equal(result.inserted, 39);
    assert.equal(result.deferred.length, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM catalog_sources").get()!.count, 41);
    const models = store.listModels();
    for (const model of models) {
      const { brand, name, cylinderType, pinCount, min, max, macs } = model;
      assert.equal(modelSchema.safeParse({ brand, name, cylinderType, pinCount, min, max, macs }).success, true);
      assert.equal(cylinderType, "paracentrique");
      assert.equal(pinCount, 5);
      assert.equal(min, 0);
      assert.equal(max, model.measurementSource!.depths.length - 1);
      assert.equal(model.verified, false);
      assert.ok(model.pendingFields.includes("pinCount"));
      assert.ok(model.pendingFields.includes("min"));
    }
    const abus = models.find(model => model.brand === "Abus" && model.name === "Base EUR")!;
    assert.equal(abus.macs, 5);
    assert.equal(abus.max, 8);
    assert.equal(abus.measurementSource!.depths[0], 7.65);
    assert.equal(abus.measurementSource!.unit, "mm");
    assert.equal(models.find(model => model.brand === "ARROW")!.measurementSource!.depths[0], 0.312);
    assert.equal(models.filter(model => model.brand === "TRELOCK").length, 2);
    assert.equal(models.filter(model => model.brand === "YALE").length, 2);
    assert.equal(models.find(model => model.brand === "CES" && model.name === "alt EUR")!.measurementSource!.depths[3], 6.95);
    for (const model of models.filter(model => model.brand === "EMHART" || model.name === "BIAXIAL US" || model.name === "neu EUR")) {
      assert.equal(model.macs, null);
      assert.ok(model.pendingFields.includes("macs"));
    }
    assert.equal(baseProfiles.find(profile => profile.brand === "ZEISS-IKON")!.source.depths.length, 20);
    assert.equal(baseProfiles.find(profile => profile.brand === "BASI")!.source.macs, 11);
  } finally { store.close(); }
});

test("Excel import never duplicates or overwrites existing and corrected profiles", () => {
  const store = new Store(":memory:");
  try {
    const existing = store.createModel({ brand: "ABUS", name: "Base EUR", pinCount: 6, min: 1, max: 9, macs: 3 });
    assert.equal(seedCatalog(store.db).inserted, 38);
    assert.deepEqual(store.getModel(existing.id), existing);
    const imported = store.listModels().find(model => model.brand === "SCHLAGE")!;
    const updated = store.patchModel(imported.id, { name: "Corrigé", pinCount: 6, verify: true });
    const again = seedCatalog(store.db);
    assert.equal(again.inserted, 0);
    assert.equal(again.existing, 39);
    assert.deepEqual(store.getModel(imported.id), updated);
    assert.deepEqual(updated.measurementSource, imported.measurementSource);
  } finally { store.close(); }
});
