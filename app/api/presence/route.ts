import {
  ensureSchema,
  getUserBySession,
  markUserOffline,
  markUserOnline,
} from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { action?: "join" | "leave" };
    if (payload.action === "leave") await markUserOffline(user.id, user.name);
    else await markUserOnline(user.id, user.name);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo actualizar la presencia." },
      { status: 500 },
    );
  }
}
