import { handler, json, body, requireAdmin } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async req => {
    const actor = requireAdmin(req);
    getStore().resetPassword(actor, (await context.params).id, await body(req));
    return json({ ok: true });
  })(request);
}
