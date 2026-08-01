import { assertRuntimeConfiguration, db, ensureSchema } from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertRuntimeConfiguration();
    await ensureSchema();
    const result = await db().prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (result?.ok !== 1) throw new Error("Database check failed");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] storage check failed", error);
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
