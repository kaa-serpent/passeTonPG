import { getStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    getStore().db.prepare("SELECT 1").get();
    return Response.json({ status: "ok", service: "passetonpg" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable", service: "passetonpg" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
