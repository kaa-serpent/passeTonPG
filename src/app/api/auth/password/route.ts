import { handler, json, body, session, requireUser } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handler(async request => {
  const actor = requireUser(request, true);
  getStore().rateLimit(`password:${actor.id}`, 8);
  const user = getStore().changePassword(actor, await body(request));
  return session(json({ user }), getStore().createSession(user.id));
});
