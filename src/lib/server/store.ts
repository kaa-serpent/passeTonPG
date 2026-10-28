import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { cylinderTypes, pinCountValid, normalizeCylinderSettings } from "../types";
import type { Project, Model, User } from "../types";

export class AppError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]/gu, "");
}
const username = z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u);
const password = z.string().min(10, "Le mot de passe doit contenir au moins 10 caractères.").max(128);
export const credentialsSchema = z.object({ username, password }).strict();
export const passwordSchema = z.object({ currentPassword: z.string().max(128), newPassword: password }).strict();
export const resetSchema = z.object({ password }).strict();
const digit = z.number().int().min(0).max(9);
const settingsShape = { pinCount: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11)]), min: digit, max: digit, macs: digit.nullable() };
const cylinderType = z.enum(cylinderTypes).nullable();
const id = z.string().uuid();
const entrySchema = z.object({
  id, type: z.enum(["key", "cylinder"]), name: z.string().trim().min(1).max(120),
  description: z.string().max(4000), positions: z.array(z.array(digit).min(1).max(10).nullable()).min(5).max(11),
}).strict();
export const projectSchema = z.object({
  id, name: z.string().trim().min(1).max(120), description: z.string().max(4000), cylinderType: cylinderType.default(null), ...settingsShape,
  modelId: id.nullable(), modelVersion: z.number().int().positive().nullable(),
  entries: z.array(entrySchema), revision: z.number().int().min(0), updatedAt: z.string().max(50),
}).strict().superRefine((project, ctx) => {
  if (!pinCountValid(project.pinCount, project.cylinderType)) ctx.addIssue({ code: "custom", path: ["pinCount"], message: "Choisissez 5 à 11 disques, ou 5 ou 6 goupilles selon le type de cylindre." });
  if (project.min > project.max) ctx.addIssue({ code: "custom", message: "Le minimum ne peut pas dépasser le maximum." });
  if ((project.modelId === null) !== (project.modelVersion === null)) ctx.addIssue({ code: "custom", message: "La référence du modèle est incomplète." });
  const ids = new Set<string>();
  for (const entry of project.entries) {
    if (ids.has(entry.id)) ctx.addIssue({ code: "custom", message: "Deux cartes ont le même identifiant." });
    ids.add(entry.id);
    if (entry.positions.length !== project.pinCount) ctx.addIssue({ code: "custom", message: "Le nombre de positions ne correspond pas au projet." });
    for (const position of entry.positions) {
      if (entry.type === "key" && (!position || position.length !== 1)) ctx.addIssue({ code: "custom", message: "Une clé doit avoir une valeur pour chaque position." });
      if (position && (new Set(position).size !== position.length || position.some(value => value < project.min || value > project.max))) ctx.addIssue({ code: "custom", message: "Les valeurs des positions doivent être uniques et dans la plage du projet." });
    }
  }
}).transform(normalizeCylinderSettings);
export const projectBodySchema = z.object({ project: projectSchema }).strict();
const modelShape = { cylinderType, brand: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), ...settingsShape };
export const modelSchema = z.object({ ...modelShape, cylinderType: cylinderType.default(null) }).strict().refine(value => pinCountValid(value.pinCount, value.cylinderType), { path: ["pinCount"], message: "Choisissez 5 à 11 disques, ou 5 ou 6 goupilles selon le type de cylindre." }).refine(value => value.min <= value.max, "Le minimum ne peut pas dépasser le maximum.").refine(value => !!normalize(value.brand) && !!normalize(value.name), "La marque et le modèle doivent contenir des lettres ou chiffres.").transform(normalizeCylinderSettings);
export const modelPatchSchema = z.object({ ...Object.fromEntries(Object.entries(modelShape).map(([key, value]) => [key, value.optional()])) as { [K in keyof typeof modelShape]: z.ZodOptional<(typeof modelShape)[K]> }, verify: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0, "Aucune modification renseignée.");

function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
const dummyHash = hashPassword(randomBytes(24).toString("hex"));
function verifyPassword(value: string, encoded: string) {
  const [salt, hash] = encoded.split(":");
  const actual = scryptSync(value, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
type UserRow = { id: string; username: string; role: "admin" | "user"; password: string; must_change: number };
function publicUser(row: UserRow): User { return { id: row.id, username: row.username, role: row.role, mustChangePassword: !!row.must_change }; }
type ModelRow = { data: string };

export class Store {
  db: DatabaseSync;
  constructor(path: string, admin?: { username: string; password: string }) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    const migration = Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (migration < 1) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', must_change INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, brand_key TEXT NOT NULL, name_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(brand_key, name_key));
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      PRAGMA user_version=1;
      COMMIT;
    `);
    if (migration < 2) this.db.exec(`
      BEGIN IMMEDIATE;
      UPDATE models SET data=json_set(data, '$.cylinderType', NULL) WHERE json_type(data, '$.cylinderType') IS NULL;
      UPDATE projects SET data=json_set(data, '$.cylinderType', NULL) WHERE json_type(data, '$.cylinderType') IS NULL;
      PRAGMA user_version=2;
      COMMIT;
    `);
    if (migration < 3) this.db.exec(`
      BEGIN IMMEDIATE;
      UPDATE models SET data=json_set(data, '$.macs', NULL, '$.pendingFields',
        (SELECT json_group_array(value) FROM json_each(models.data, '$.pendingFields') WHERE value != 'macs'))
        WHERE json_extract(data, '$.cylinderType') = 'disque';
      UPDATE projects SET data=json_set(data, '$.macs', NULL) WHERE json_extract(data, '$.cylinderType') = 'disque';
      PRAGMA user_version=3;
      COMMIT;
    `);
    if (admin && !this.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
      const parsed = credentialsSchema.parse(admin);
      if (this.db.prepare("SELECT id FROM users WHERE username_key = ?").get(normalize(parsed.username))) throw new Error("Le pseudo administrateur est déjà utilisé. Choisissez un autre ADMIN_USERNAME.");
      this.db.prepare("INSERT INTO users (id,username,username_key,password,role) VALUES (?,?,?,?, 'admin')").run(randomUUID(), parsed.username, normalize(parsed.username), hashPassword(parsed.password));
    }
  }
  close() { this.db.close(); }
  rateLimit(key: string, max = 8, windowMs = 15 * 60_000, now = Date.now()) {
    this.db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);
    const row = this.db.prepare("INSERT INTO rate_limits(key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").get(tokenHash(key), now + windowMs) as { count: number };
    if (row.count > max) throw new AppError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }
  register(input: unknown) {
    const value = credentialsSchema.parse(input);
    const key = normalize(value.username);
    if (!key) throw new AppError(400, "Ce pseudo n’est pas valide.");
    const user: User = { id: randomUUID(), username: value.username, role: "user", mustChangePassword: false };
    try { this.db.prepare("INSERT INTO users (id,username,username_key,password) VALUES (?,?,?,?)").run(user.id, user.username, key, hashPassword(value.password)); }
    catch (error) { if (String(error).includes("UNIQUE")) throw new AppError(409, "Ce pseudo est déjà utilisé."); throw error; }
    return user;
  }
  login(input: unknown) {
    const value = credentialsSchema.parse(input);
    const row = this.db.prepare("SELECT * FROM users WHERE username_key = ?").get(normalize(value.username)) as UserRow | undefined;
    const valid = verifyPassword(value.password, row?.password ?? dummyHash);
    if (!row || !valid) throw new AppError(401, "Pseudo ou mot de passe incorrect.");
    return publicUser(row);
  }
  createSession(userId: string) {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(tokenHash(token), userId, Date.now() + 30 * 24 * 3600_000);
    return token;
  }
  userForSession(token: string | undefined): User | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db.prepare("SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").get(tokenHash(token), Date.now()) as UserRow | undefined;
    return row ? publicUser(row) : null;
  }
  logout(token?: string) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); }
  changePassword(user: User, input: unknown) {
    const value = passwordSchema.parse(input);
    const row = this.db.prepare("SELECT * FROM users WHERE id=?").get(user.id) as UserRow | undefined;
    if (!row || !verifyPassword(value.currentPassword, row.password)) throw new AppError(400, "Le mot de passe actuel est incorrect.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET password=?,must_change=0 WHERE id=?").run(hashPassword(value.newPassword), user.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { ...user, mustChangePassword: false };
  }
  listUsers() { return (this.db.prepare("SELECT * FROM users ORDER BY username_key").all() as UserRow[]).map(publicUser); }
  resetPassword(actor: User, userId: string, input: unknown) {
    const value = resetSchema.parse(input);
    if (actor.id === userId) throw new AppError(400, "Utilisez le changement de votre propre mot de passe.");
    if (!this.db.prepare("SELECT id FROM users WHERE id=?").get(userId)) throw new AppError(404, "Compte introuvable.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET password=?,must_change=1 WHERE id=?").run(hashPassword(value.password), userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  listProjects(userId: string): Project[] {
    return (this.db.prepare("SELECT data FROM projects WHERE user_id=?").all(userId) as {data: string}[]).map(row => JSON.parse(row.data) as Project).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getProject(userId: string, projectId: string): Project {
    const row = this.db.prepare("SELECT data FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as {data: string} | undefined;
    if (!row) throw new AppError(404, "Projet introuvable.");
    return JSON.parse(row.data);
  }
  saveProject(userId: string, input: unknown, creating: boolean, projectId?: string): Project {
    const { project } = projectBodySchema.parse(input);
    if (projectId && project.id !== projectId) throw new AppError(400, "L’identifiant du projet ne correspond pas.");
    if (project.modelId) {
      const model = this.getModel(project.modelId);
      if (project.modelVersion! > model.version) throw new AppError(400, "La version du modèle est inconnue.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (creating) {
        const existing = this.db.prepare("SELECT user_id,data FROM projects WHERE id=?").get(project.id) as { user_id: string; data: string } | undefined;
        if (existing) throw new AppError(409, "Ce projet existe déjà.", existing.user_id === userId ? { project: JSON.parse(existing.data) as Project } : {});
      } else {
        const current = this.getProject(userId, project.id);
        if (current.revision !== project.revision) throw new AppError(409, "Ce projet a été modifié sur un autre appareil.", { project: current });
      }
      const saved: Project = { ...project, revision: creating ? 1 : project.revision + 1, updatedAt: new Date().toISOString(), entries: project.entries.map(entry => ({ ...entry, positions: entry.positions.map(position => position ? [...position].sort((a,b) => a-b) : null) })) };
      if (creating) this.db.prepare("INSERT INTO projects(id,user_id,data) VALUES (?,?,?)").run(saved.id, userId, JSON.stringify(saved));
      else this.db.prepare("UPDATE projects SET data=? WHERE id=? AND user_id=?").run(JSON.stringify(saved), saved.id, userId);
      this.db.exec("COMMIT");
      return saved;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  deleteProject(userId: string, projectId: string) {
    const result = this.db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(projectId, userId);
    if (!result.changes) throw new AppError(404, "Projet introuvable.");
  }
  listModels(): Model[] { return (this.db.prepare("SELECT data FROM models ORDER BY brand_key,name_key").all() as ModelRow[]).map(row => JSON.parse(row.data)); }
  getModel(modelId: string): Model {
    const row = this.db.prepare("SELECT data FROM models WHERE id=?").get(modelId) as ModelRow | undefined;
    if (!row) throw new AppError(404, "Modèle introuvable.");
    return JSON.parse(row.data);
  }
  createModel(input: unknown): Model {
    const value = modelSchema.parse(input);
    const existingBrand = this.db.prepare("SELECT data FROM models WHERE brand_key=? LIMIT 1").get(normalize(value.brand)) as ModelRow | undefined;
    if (existingBrand) value.brand = (JSON.parse(existingBrand.data) as Model).brand;
    const model: Model = { ...value, id: randomUUID(), version: 1, verified: false, pendingFields: Object.keys(modelShape).filter(key => value.cylinderType !== "disque" || key !== "macs") };
    try { this.db.prepare("INSERT INTO models(id,brand_key,name_key,data) VALUES (?,?,?,?)").run(model.id, normalize(model.brand), normalize(model.name), JSON.stringify(model)); }
    catch (error) { if (String(error).includes("UNIQUE")) throw new AppError(409, "Ce modèle existe déjà pour cette marque."); throw error; }
    return model;
  }
  patchModel(modelId: string, input: unknown): Model {
    const patch = modelPatchSchema.parse(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.getModel(modelId);
      const value = modelSchema.parse({ cylinderType: patch.cylinderType === undefined ? old.cylinderType : patch.cylinderType, brand: patch.brand ?? old.brand, name: patch.name ?? old.name, pinCount: patch.pinCount ?? old.pinCount, min: patch.min ?? old.min, max: patch.max ?? old.max, macs: patch.macs === undefined ? old.macs : patch.macs });
      const model: Model = { ...old, ...value, version: old.version + 1, verified: patch.verify === undefined ? old.verified : patch.verify, pendingFields: patch.verify === true ? [] : patch.verify === false ? Object.keys(modelShape) : old.pendingFields };
      if (model.cylinderType === "disque") model.pendingFields = model.pendingFields.filter(key => key !== "macs");
      this.db.prepare("UPDATE models SET brand_key=?,name_key=?,data=? WHERE id=?").run(normalize(model.brand), normalize(model.name), JSON.stringify(model), model.id);
      this.db.exec("COMMIT");
      return model;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (String(error).includes("UNIQUE")) throw new AppError(409, "Ce modèle existe déjà pour cette marque.");
      throw error;
    }
  }
}

const globalStore = globalThis as typeof globalThis & { ptpgStore?: Store };
export function getStore(): Store {
  if (!globalStore.ptpgStore) {
    if (!!process.env.ADMIN_USERNAME !== !!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_USERNAME et ADMIN_PASSWORD doivent être renseignés ensemble pour initialiser l’administrateur.");
    const admin = process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD ? { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } : undefined;
    globalStore.ptpgStore = new Store(process.env.DATABASE_PATH || "data/passetonpg.sqlite", admin);
  }
  return globalStore.ptpgStore;
}
