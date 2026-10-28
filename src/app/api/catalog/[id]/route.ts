import { handler, json, body, requireAdmin } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async req => {
    requireAdmin(req);
    return json({ model: getStore().patchModel((await context.params).id, await body(req)) });
  })(request);
}
