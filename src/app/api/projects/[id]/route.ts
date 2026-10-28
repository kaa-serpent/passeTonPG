import { handler, json, body, requireUser } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handler(async req => json({ project: getStore().getProject(requireUser(req).id, (await context.params).id) }))(request);
}
export async function PUT(request: Request, context: Context) {
  return handler(async req => {
    const user = requireUser(req);
    return json({ project: getStore().saveProject(user.id, await body(req), false, (await context.params).id) });
  })(request);
}
export async function DELETE(request: Request, context: Context) {
  return handler(async req => {
    getStore().deleteProject(requireUser(req).id, (await context.params).id);
    return json({ ok: true });
  })(request);
}
