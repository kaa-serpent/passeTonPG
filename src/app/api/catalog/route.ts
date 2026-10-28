import { handler, json, body, requireUser } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handler(() => json({ models: getStore().listModels() }));
export const POST = handler(async request => {
  const user = requireUser(request);
  getStore().rateLimit(`catalog-create:${user.id}`, 60, 60_000);
  return json({ model: getStore().createModel(await body(request)) }, 201);
});
