import { handler, json, requireAdmin } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handler(request => {
  requireAdmin(request);
  return json({ users: getStore().listUsers() });
});
