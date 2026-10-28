import { handler, json, body, requireUser } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handler(request => json({ projects: getStore().listProjects(requireUser(request).id) }));
export const POST = handler(async request => {
  const user = requireUser(request);
  return json({ project: getStore().saveProject(user.id, await body(request), true) }, 201);
});
