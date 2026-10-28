import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, Store, getStore, normalize, projectSchema } from "../src/lib/server/store";
import { ensureOrigin, handler, json, session } from "../src/lib/server/http";
import type { Project } from "../src/lib/types";

const credentials = { username: "Utilisateur", password: "mot-de-passe-1234" };
function project(): Project {
  return { id: randomUUID(), name: "Essai", description: "", pinCount: 5, min: 0, max: 9, macs: null, cylinderType: null, modelId: null, modelVersion: null, entries: [], revision: 0, updatedAt: new Date().toISOString() };
}
function fails(status: number) { return (error: unknown) => error instanceof AppError && error.status === status; }

test("comptes normalisés, mots de passe hachés et sessions opaques révocables", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    assert.equal(store.login({ ...credentials, username: "UTILISATEUR" }).id, user.id);
    assert.throws(() => store.register({ ...credentials, username: "utilisateur" }), fails(409));
    assert.throws(() => store.login({ ...credentials, password: "mauvais-mot-de-passe" }), fails(401));
    const token = store.createSession(user.id);
    assert.equal(store.userForSession(token)?.id, user.id);
    const raw = store.db.prepare("SELECT * FROM users").get()!;
    assert.notEqual(raw.password, credentials.password);
    const saved = store.db.prepare("SELECT * FROM sessions").get()!;
    assert.notEqual(saved.token_hash, token);
    assert.equal(store.userForSession("invalide"), null);
    store.logout(token);
    assert.equal(store.userForSession(token), null);
    const expired = store.createSession(user.id);
    store.db.prepare("UPDATE sessions SET expires_at=0").run();
    assert.equal(store.userForSession(expired), null);
  } finally { store.close(); }
});

test("administrateur initial unique et réinitialisation avec révocation de toutes les sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "ptpg-"));
  const path = join(directory, "test.sqlite");
  let store = new Store(path, { username: "Administrateur", password: "admin-long-password" });
  try {
    const admin = store.login({ username: "Administrateur", password: "admin-long-password" });
    assert.equal(admin.role, "admin");
    const user = store.register(credentials);
    const token1 = store.createSession(user.id);
    const token2 = store.createSession(user.id);
    store.resetPassword(admin, user.id, { password: "nouveau-mot-de-passe" });
    assert.equal(store.userForSession(token1), null);
    assert.equal(store.userForSession(token2), null);
    const resetUser = store.login({ username: user.username, password: "nouveau-mot-de-passe" });
    assert.equal(resetUser.mustChangePassword, true);
    const changed = store.changePassword(resetUser, { currentPassword: "nouveau-mot-de-passe", newPassword: "encore-un-mot-de-passe" });
    assert.equal(changed.mustChangePassword, false);
    assert.throws(() => store.resetPassword(admin, admin.id, { password: "autre-mot-de-passe" }), fails(400));
    store.close();
    store = new Store(path, { username: "AutreAdmin", password: "autre-password-123" });
    assert.equal(store.listUsers().filter(value => value.role === "admin").length, 1);
    assert.equal(store.listUsers().length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("isolation des projets, sauvegarde transactionnelle et conflits de révision", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    const other = store.register({ ...credentials, username: "Autre" });
    const input = project();
    input.entries.push({ id: randomUUID(), type: "cylinder", name: "Cylindre 1", description: "", positions: [[6, 4], null, [0], [3], [7]] });
    const saved = store.saveProject(user.id, { project: input }, true);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.entries[0].positions[0], [4, 6]);
    assert.throws(() => store.saveProject(user.id, { project: input }, true), error => error instanceof AppError && error.status === 409 && (error.extra.project as Project).revision === 1);
    assert.throws(() => store.saveProject(other.id, { project: input }, true), error => error instanceof AppError && error.status === 409 && !("project" in error.extra));
    assert.equal(store.listProjects(other.id).length, 0);
    assert.throws(() => store.getProject(other.id, saved.id), fails(404));
    assert.throws(() => store.saveProject(other.id, { project: saved }, false), fails(404));
    assert.throws(() => store.deleteProject(other.id, saved.id), fails(404));
    const updated = store.saveProject(user.id, { project: { ...saved, name: "Modifié" } }, false);
    assert.equal(updated.revision, 2);
    assert.throws(() => store.saveProject(user.id, { project: { ...saved, name: "Concurrent" } }, false), error => error instanceof AppError && error.status === 409 && (error.extra.project as Project).name === "Modifié");
    assert.equal(store.getProject(user.id, saved.id).name, "Modifié");
    store.deleteProject(user.id, saved.id);
    assert.equal(store.listProjects(user.id).length, 0);
  } finally { store.close(); }
});

test("validation des positions, plages, références et clés complètes", () => {
  const input = project();
  assert.equal(projectSchema.safeParse({ ...input, min: 6, max: 2 }).success, false);
  assert.equal(projectSchema.safeParse({ ...input, pinCount: 7 }).success, false);
  assert.equal(projectSchema.safeParse({ ...input, min: -1 }).success, false);
  assert.equal(projectSchema.safeParse({ ...input, modelId: randomUUID() }).success, false);
  const entry = { id: randomUUID(), type: "key", name: "Clé", description: "", positions: [[0], [1], [2], [3], [4]] };
  assert.equal(projectSchema.safeParse({ ...input, entries: [entry] }).success, true);
  assert.equal(projectSchema.safeParse({ ...input, entries: [{ ...entry, positions: [[0], [1], null, [3], [4]] }] }).success, false);
  assert.equal(projectSchema.safeParse({ ...input, entries: [{ ...entry, type: "cylinder", positions: [[0, 0], [1], null, [3], [4]] }] }).success, false);
  assert.equal(projectSchema.safeParse({ ...input, entries: [{ ...entry, type: "cylinder", positions: [[0], [1], null, [3], [4]] }] }).success, true);
  assert.equal(projectSchema.safeParse({ ...input, entries: [entry, entry] }).success, false);
});

test("enregistre les cylindres à 5–11 disques et valide les limites selon le type", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    for (const pinCount of [5, 6, 7, 8, 9, 10, 11] as const) {
      const model = store.createModel({ brand: "Disques", name: `Modèle ${pinCount}`, cylinderType: "disque", pinCount, min: 0, max: 9, macs: null });
      const input = { ...project(), cylinderType: "disque" as const, pinCount, entries: [{ id: randomUUID(), type: "cylinder" as const, name: "Cylindre", description: "", positions: Array.from({ length: pinCount }, () => null) }] };
      const saved = store.saveProject(user.id, { project: input }, true);
      assert.equal(saved.pinCount, pinCount);
      assert.equal(saved.entries[0].positions.length, pinCount);
      assert.equal(store.getModel(model.id).pinCount, pinCount);
      assert.equal(projectSchema.safeParse({ ...input, pinCount: 12 }).success, false);
      assert.equal(projectSchema.safeParse({ ...input, pinCount: 4 }).success, false);
      if (pinCount > 6) {
        assert.equal(projectSchema.safeParse({ ...input, cylinderType: null }).success, false);
        assert.equal(projectSchema.safeParse({ ...input, cylinderType: "radial" }).success, false);
        assert.throws(() => store.patchModel(model.id, { cylinderType: "paracentrique" }));
      }
    }
    const model = store.createModel({ brand: "Disques", name: "Évolutif", pinCount: 5, min: 0, max: 9, macs: null });
    assert.equal(store.patchModel(model.id, { cylinderType: "disque", pinCount: 11 }).pinCount, 11);
  } finally { store.close(); }
});

test("catalogue normalisé, contributions à valider et versions sans modifier les projets", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    const settings = { brand: "Marqué - A", name: "Modèle 1", pinCount: 5 as const, min: 0, max: 9, macs: null };
    const model = store.createModel(settings);
    assert.equal(normalize("Marqué - A"), normalize("marque a"));
    assert.equal(model.verified, false);
    assert.ok(model.pendingFields.includes("macs"));
    assert.throws(() => store.createModel({ ...settings, brand: "MARQUE A", name: "modele-1" }), fails(409));
    const secondModel = store.createModel({ ...settings, brand: "marque-a", name: "Autre modèle" });
    assert.equal(secondModel.brand, model.brand);
    const original = store.saveProject(user.id, { project: { ...project(), modelId: model.id, modelVersion: model.version } }, true);
    const verified = store.patchModel(model.id, { verify: true, macs: 3 });
    assert.equal(verified.version, 2);
    assert.equal(verified.verified, true);
    assert.deepEqual(verified.pendingFields, []);
    const unchanged = store.getProject(user.id, original.id);
    assert.equal(unchanged.macs, null);
    assert.equal(unchanged.modelVersion, 1);
    assert.equal(store.listModels().find(value => value.id === model.id)!.macs, 3);
    assert.throws(() => store.patchModel(model.id, { min: 8, max: 2 }));
    assert.equal(store.getModel(model.id).version, 2);
  } finally { store.close(); }
});

test("configuration administrateur incomplète : erreur explicite avant ouverture de la base", () => {
  const registry = globalThis as typeof globalThis & { ptpgStore?: Store };
  const previousStore = registry.ptpgStore;
  const previousUser = process.env.ADMIN_USERNAME;
  const previousPassword = process.env.ADMIN_PASSWORD;
  delete registry.ptpgStore;
  try {
    process.env.ADMIN_USERNAME = "Admin";
    delete process.env.ADMIN_PASSWORD;
    assert.throws(() => getStore(), /ADMIN_USERNAME et ADMIN_PASSWORD/);
    delete process.env.ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = "mot-de-passe-long";
    assert.throws(() => getStore(), /ADMIN_USERNAME et ADMIN_PASSWORD/);
  } finally {
    registry.ptpgStore = previousStore;
    if (previousUser === undefined) delete process.env.ADMIN_USERNAME; else process.env.ADMIN_USERNAME = previousUser;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previousPassword;
  }
});

test("limitation des tentatives persistante et expiration de la fenêtre", () => {
  const store = new Store(":memory:");
  try {
    store.rateLimit("login:user", 2, 1000, 0);
    store.rateLimit("login:user", 2, 1000, 1);
    assert.throws(() => store.rateLimit("login:user", 2, 1000, 2), fails(429));
    assert.doesNotThrow(() => store.rateLimit("login:other", 2, 1000, 3));
    assert.doesNotThrow(() => store.rateLimit("login:user", 2, 1000, 1001));
  } finally { store.close(); }
});

test("protection origine, cookies de session et erreurs JSON sans détails internes", async () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  try {
    const request = (origin?: string) => new Request("http://localhost:8080/api/auth/login", { method: "POST", headers: origin ? { origin, "content-type": "application/json" } : {}, body: "{}" });
    assert.doesNotThrow(() => ensureOrigin(request("http://localhost:8080")));
    assert.throws(() => ensureOrigin(request("https://evil.example")), fails(403));
    assert.throws(() => ensureOrigin(request()), fails(403));
    const denied = await handler(() => json({ ok: true }))(request("https://evil.example"));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    const response = session(json({ ok: true }), "test-token");
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=lax/i);
    assert.equal((await denied.json()).error.length > 0, true);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test("API : authentification, isolation même pour admin, catalogue et changement forcé", async () => {
  const registry = globalThis as typeof globalThis & { ptpgStore?: Store };
  const oldStore = registry.ptpgStore;
  const oldOrigin = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  const store = new Store(":memory:", { username: "AdminTest", password: "mot-de-passe-admin" });
  registry.ptpgStore = store;
  try {
    const login = (await import("../src/app/api/auth/login/route")).POST;
    const register = (await import("../src/app/api/auth/register/route")).POST;
    const me = (await import("../src/app/api/auth/me/route")).GET;
    const password = (await import("../src/app/api/auth/password/route")).POST;
    const projects = await import("../src/app/api/projects/route");
    const oneProject = await import("../src/app/api/projects/[id]/route");
    const catalog = await import("../src/app/api/catalog/route");
    const modelRoute = await import("../src/app/api/catalog/[id]/route");
    const reset = (await import("../src/app/api/admin/users/[id]/reset/route")).POST;
    function request(path: string, method = "GET", data?: unknown, cookie?: string) {
      return new Request(`http://localhost:8080/api/${path}`, { method, headers: { origin: "http://localhost:8080", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    }
    function cookie(response: Response) { return response.headers.get("set-cookie")!.split(";")[0]; }
    const anonymous = await projects.GET(request("projects"));
    assert.equal(anonymous.status, 401);
    const registered = await register(request("auth/register", "POST", credentials));
    assert.equal(registered.status, 201);
    const user = (await registered.json()).user;
    let userCookie = cookie(registered);
    const staleAccount = request("projects", "POST", { project: project() }, userCookie);
    staleAccount.headers.set("x-account-id", randomUUID());
    assert.equal((await projects.POST(staleAccount)).status, 401);
    assert.equal(store.listProjects(user.id).length, 0);
    const adminLogin = await login(request("auth/login", "POST", { username: "AdminTest", password: "mot-de-passe-admin" }));
    const adminCookie = cookie(adminLogin);
    const modelResponse = await catalog.POST(request("catalog", "POST", { brand: "Marque", name: "Modèle", pinCount: 5, min: 0, max: 9, macs: null }, userCookie));
    assert.equal(modelResponse.status, 201);
    const model = (await modelResponse.json()).model;
    const modelContext = { params: Promise.resolve({ id: model.id }) };
    assert.equal((await modelRoute.PATCH(request(`catalog/${model.id}`, "PATCH", { verify: true }, userCookie), modelContext)).status, 403);
    assert.equal((await modelRoute.PATCH(request(`catalog/${model.id}`, "PATCH", { verify: true }, adminCookie), modelContext)).status, 200);
    const createdResponse = await projects.POST(request("projects", "POST", { project: project() }, userCookie));
    assert.equal(createdResponse.status, 201);
    const saved = (await createdResponse.json()).project as Project;
    const retriedResponse = await projects.POST(request("projects", "POST", { project: saved }, userCookie));
    assert.equal(retriedResponse.status, 409);
    assert.equal((await retriedResponse.json()).project.id, saved.id);
    const otherOwnerResponse = await projects.POST(request("projects", "POST", { project: saved }, adminCookie));
    assert.equal(otherOwnerResponse.status, 409);
    assert.equal((await otherOwnerResponse.json()).project, undefined);
    const context = { params: Promise.resolve({ id: saved.id }) };
    assert.equal((await oneProject.GET(request(`projects/${saved.id}`, "GET", undefined, adminCookie), context)).status, 404);
    const updatedResponse = await oneProject.PUT(request(`projects/${saved.id}`, "PUT", { project: saved }, userCookie), context);
    assert.equal(updatedResponse.status, 200);
    assert.equal((await oneProject.PUT(request(`projects/${saved.id}`, "PUT", { project: saved }, userCookie), context)).status, 409);
    const resetContext = { params: Promise.resolve({ id: user.id }) };
    assert.equal((await reset(request(`admin/users/${user.id}/reset`, "POST", { password: "password-reset-123" }, adminCookie), resetContext)).status, 200);
    assert.equal((await projects.GET(request("projects", "GET", undefined, userCookie))).status, 401);
    const resetLogin = await login(request("auth/login", "POST", { username: credentials.username, password: "password-reset-123" }));
    userCookie = cookie(resetLogin);
    assert.equal((await me(request("auth/me", "GET", undefined, userCookie))).status, 200);
    assert.equal((await projects.GET(request("projects", "GET", undefined, userCookie))).status, 403);
    const passwordResponse = await password(request("auth/password", "POST", { currentPassword: "password-reset-123", newPassword: "password-replaced-123" }, userCookie));
    assert.equal(passwordResponse.status, 200);
    assert.equal((await projects.GET(request("projects", "GET", undefined, userCookie))).status, 401);
    userCookie = cookie(passwordResponse);
    assert.equal((await projects.GET(request("projects", "GET", undefined, userCookie))).status, 200);
  } finally {
    store.close();
    registry.ptpgStore = oldStore;
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = oldOrigin;
  }
});


test("types de cylindres persistés, validés et indépendants des mises à jour du modèle", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    const settings = { brand: "Marque", name: "Modèle", pinCount: 5, min: 0, max: 9, macs: null };
    for (const cylinderType of ["paracentrique", "radial", "disque"] as const) {
      const model = store.createModel({ ...settings, name: cylinderType, cylinderType });
      assert.equal(store.getModel(model.id).cylinderType, cylinderType);
      assert.equal(store.listModels().find(item => item.id === model.id)!.cylinderType, cylinderType);
      assert.ok(model.pendingFields.includes("cylinderType"));
      const saved = store.saveProject(user.id, { project: { ...project(), cylinderType, modelId: model.id, modelVersion: model.version } }, true);
      const raw = store.db.prepare("SELECT data FROM projects WHERE id=?").get(saved.id) as { data: string };
      assert.equal(JSON.parse(raw.data).cylinderType, cylinderType);
      assert.equal(store.listProjects(user.id).find(item => item.id === saved.id)!.cylinderType, cylinderType);
      const verified = store.patchModel(model.id, { verify: true });
      assert.equal(verified.cylinderType, cylinderType);
      const changed = store.patchModel(model.id, { cylinderType: "radial" });
      assert.equal(changed.cylinderType, "radial");
      assert.equal(store.getProject(user.id, saved.id).cylinderType, cylinderType);
      const updated = store.saveProject(user.id, { project: { ...saved, cylinderType: "disque" } }, false);
      assert.equal(updated.cylinderType, "disque");
      assert.equal(store.patchModel(model.id, { cylinderType: null }).cylinderType, null);
    }
    assert.throws(() => store.createModel({ ...settings, cylinderType: "invalide" }));
    const model = store.listModels()[0];
    assert.throws(() => store.patchModel(model.id, { cylinderType: "invalide" }));
    assert.equal(projectSchema.safeParse({ ...project(), cylinderType: "invalide" }).success, false);
    const { cylinderType: omitted, ...legacyProject } = project();
    assert.equal(projectSchema.parse(legacyProject).cylinderType, null);
  } finally { store.close(); }
});

test("migration des anciennes fiches sans type et conservation au redémarrage", () => {
  const directory = mkdtempSync(join(tmpdir(), "ptpg-types-"));
  const path = join(directory, "test.sqlite");
  let store = new Store(path);
  try {
    const user = store.register(credentials);
    const model = store.createModel({ brand: "Ancienne marque", name: "Ancien modèle", pinCount: 5, min: 0, max: 9, macs: null });
    const saved = store.saveProject(user.id, { project: project() }, true);
    const typedModel = store.createModel({ brand: "Marque", name: "Radial", cylinderType: "radial", pinCount: 6, min: 0, max: 9, macs: null });
    store.db.prepare("UPDATE models SET data=json_remove(data, '$.cylinderType') WHERE id=?").run(model.id);
    store.db.exec("UPDATE projects SET data=json_remove(data, '$.cylinderType'); PRAGMA user_version=1;");
    store.close();
    store = new Store(path);
    assert.equal(store.getModel(model.id).cylinderType, null);
    assert.equal(store.getModel(model.id).version, model.version);
    assert.equal(store.getProject(user.id, saved.id).cylinderType, null);
    assert.equal(store.getProject(user.id, saved.id).revision, saved.revision);
    assert.equal(store.getModel(typedModel.id).cylinderType, "radial");
    assert.equal(store.db.prepare("PRAGMA user_version").get()!.user_version, 3);
    store.close();
    store = new Store(path);
    assert.equal(store.getModel(typedModel.id).cylinderType, "radial");
    assert.equal(store.getModel(model.id).cylinderType, null);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("MACS is cleared for disc model and project writes, including type changes", () => {
  const store = new Store(":memory:");
  try {
    const user = store.register(credentials);
    const model = store.createModel({ brand: "Disc", name: "Test", cylinderType: "disque", pinCount: 6, min: 0, max: 9, macs: 1 });
    assert.equal(model.macs, null);
    assert.equal(model.pendingFields.includes("macs"), false);
    assert.equal(store.patchModel(model.id, { macs: 2, verify: false }).macs, null);
    assert.equal(store.getModel(model.id).pendingFields.includes("macs"), false);
    assert.equal(store.patchModel(model.id, { cylinderType: "radial", macs: 2 }).macs, 2);
    assert.equal(store.patchModel(model.id, { cylinderType: "disque" }).macs, null);
    const saved = store.saveProject(user.id, { project: { ...project(), cylinderType: "radial", macs: 2 } }, true);
    const updated = store.saveProject(user.id, { project: { ...saved, cylinderType: "disque" } }, false);
    assert.equal(updated.macs, null);
    const raw = store.db.prepare("SELECT data FROM projects WHERE id=?").get(saved.id) as { data: string };
    assert.equal(JSON.parse(raw.data).macs, null);
  } finally { store.close(); }
});

test("migration 3 clears disc MACS without changing pin models, revisions or versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "ptpg-disc-macs-"));
  const path = join(directory, "test.sqlite");
  let store = new Store(path);
  try {
    const user = store.register(credentials);
    const settings = { brand: "Test", pinCount: 5, min: 0, max: 9, macs: 2 };
    const disc = store.createModel({ ...settings, name: "Disque", cylinderType: "disque" });
    const radial = store.createModel({ ...settings, name: "Radial", cylinderType: "radial" });
    const saved = store.saveProject(user.id, { project: { ...project(), cylinderType: "disque" } }, true);
    store.db.prepare("UPDATE models SET data=json_set(data, '$.macs', 1, '$.pendingFields', json('[\"macs\",\"min\"]')) WHERE id=?").run(disc.id);
    store.db.prepare("UPDATE projects SET data=json_set(data, '$.macs', 1) WHERE id=?").run(saved.id);
    store.db.exec("PRAGMA user_version=2");
    store.close();
    store = new Store(path);
    assert.equal(store.getModel(disc.id).macs, null);
    assert.deepEqual(store.getModel(disc.id).pendingFields, ["min"]);
    assert.equal(store.getModel(disc.id).version, disc.version);
    assert.equal(store.getModel(radial.id).macs, 2);
    assert.equal(store.getProject(user.id, saved.id).macs, null);
    assert.equal(store.getProject(user.id, saved.id).revision, saved.revision);
    assert.equal(store.db.prepare("PRAGMA user_version").get()!.user_version, 3);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
