import { handler, json, sessionToken } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handler(request => json({ user: getStore().userForSession(sessionToken(request)) }));
