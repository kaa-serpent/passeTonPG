import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { User } from "../types";
import { AppError, getStore, normalize } from "./store";

export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function sessionToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("ptpg_session="))?.slice("ptpg_session=".length);
}
export function session(response: NextResponse, token: string | null) {
  response.cookies.set("ptpg_session", token ?? "", { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/", maxAge: token ? 30 * 24 * 3600 : 0 });
  return response;
}
export function requireUser(request: Request, allowPasswordChange = false): User {
  const user = getStore().userForSession(sessionToken(request));
  if (!user) throw new AppError(401, "Connectez-vous pour continuer.");
  ensureAccount(request, user);
  if (user.mustChangePassword && !allowPasswordChange) throw new AppError(403, "Vous devez changer votre mot de passe avant de continuer.", { mustChangePassword: true });
  return user;
}
export function ensureAccount(request: Request, user: User | null) {
  const expected = request.headers.get("x-account-id");
  if (expected && user && expected !== user.id) {
    throw new AppError(401, "Le compte connecté a changé dans un autre onglet. Rechargez cette page avant de continuer.");
  }
}
export function requireAdmin(request: Request): User {
  const user = requireUser(request);
  if (user.role !== "admin") throw new AppError(403, "Cette action est réservée à l’administrateur.");
  return user;
}
export async function body(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new AppError(413, "Le contenu envoyé est trop volumineux.");
  try { return JSON.parse(text) as unknown; } catch { throw new AppError(400, "Le contenu envoyé n’est pas valide."); }
}
export function ensureOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "Cette requête n’est pas autorisée depuis ce site.");
  const type = request.headers.get("content-type");
  if (type && !type.toLowerCase().startsWith("application/json")) throw new AppError(415, "Un contenu JSON est attendu.");
}
export function authRate(request: Request, input: unknown, registration = false) {
  // Nginx appends the actual peer last; never trust a client-supplied first hop.
  const ip = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local" : "local";
  const key = typeof input === "object" && input && "username" in input && typeof input.username === "string" ? normalize(input.username) : "invalid";
  const store = getStore();
  store.rateLimit(`${registration ? "register" : "login"}:ip:${ip}`, registration ? 20 : 60);
  store.rateLimit(`${registration ? "register" : "login"}:user:${key}`, registration ? 5 : 8);
}
export function handler(fn: (request: Request) => Promise<NextResponse> | NextResponse) {
  return async (request: Request) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) ensureOrigin(request);
      return await fn(request);
    } catch (error) {
      if (error instanceof AppError) return json({ error: error.message, ...error.extra }, error.status);
      if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Les données saisies ne sont pas valides." }, 400);
      console.error("Erreur serveur PasseTonPG", error);
      return json({ error: "Une erreur est survenue. Réessayez dans un instant." }, 500);
    }
  };
}
