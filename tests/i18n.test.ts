import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import english from "../src/lib/translations.en.json";
import { translate } from "../src/lib/i18n";

test("translations preserve French, interpolate once and preserve user content", () => {
  assert.equal(translate("Mes projets", "fr"), "Mes projets");
  assert.equal(translate("Mes projets", "en"), "My projects");
  assert.equal(translate("Modifier {name}", "en", { name: "Résidence {count}" }), "Edit Résidence {count}");
  assert.equal(translate("Projet inconnu {name}", "fr", { name: "Étage 2" }), "Projet inconnu Étage 2");
  assert.equal(translate(" Valeurs ", "en"), " Values ");
  assert.equal(translate("Custom content", "en"), "Custom content");
});

test("English messages preserve every interpolation parameter", () => {
  const parameters = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, translation] of Object.entries(english)) {
    assert.deepEqual(parameters(translation), parameters(source), source);
  }
});

test("all static UI translation calls have English messages", () => {
  for (const file of ["workspace.tsx", "forms.tsx", "pwa-register.tsx", "language-provider.tsx", "model-measurements.tsx"]) {
    const path = `src/components/${file}`;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        assert.ok(Object.hasOwn(english, key) || Object.hasOwn(english, key.trim()), `${file}: ${key}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
