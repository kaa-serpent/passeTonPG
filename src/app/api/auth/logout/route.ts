import { handler, json, session, sessionToken, ensureAccount } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handler(request => {
  ensureAccount(request, getStore().userForSession(sessionToken(request)));
  getStore().logout(sessionToken(request));
  return session(json({ ok: true }), null);
});
