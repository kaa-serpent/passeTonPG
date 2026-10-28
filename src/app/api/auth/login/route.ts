import { handler, json, body, session, authRate } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handler(async request => {
  const input = await body(request);
  authRate(request, input);
  const store = getStore();
  const user = store.login(input);
  return session(json({ user }), store.createSession(user.id));
});
