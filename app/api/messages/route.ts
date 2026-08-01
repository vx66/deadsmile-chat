import {
  ChatMessage,
  db,
  ensureSchema,
  getUserBySession,
} from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  room_id: string;
  body: string;
  image_url: string | null;
  message_type: "user" | "system";
  is_pinned: number;
  edited_at: string | null;
  reply_id: string | null;
  reply_body: string | null;
  reply_image_url: string | null;
  reply_user_name: string | null;
  created_at: string;
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  user_role: "admin" | "member";
};

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    body: row.body,
    imageUrl: row.image_url,
    type: row.message_type,
    isPinned: row.is_pinned === 1,
    editedAt: row.edited_at,
    replyTo: row.reply_id && row.reply_user_name ? {
      id: row.reply_id,
      body: row.reply_body || (row.reply_image_url ? "[imagen]" : "[mensaje]") ,
      userName: row.reply_user_name,
    } : null,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      avatarUrl: row.avatar_url,
      role: row.user_role,
    },
  };
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Conecta tu identidad para leer el canal." }, { status: 401 });
    const roomId = new URL(request.url).searchParams.get("room") ?? "lobby";
    const { results } = await db().prepare(`SELECT m.id, m.room_id, m.body, m.image_url, m.message_type,
      m.is_pinned, m.edited_at, m.created_at, r.id AS reply_id, r.body AS reply_body,
      r.image_url AS reply_image_url, ru.name AS reply_user_name,
      u.id AS user_id, u.name AS user_name, u.avatar_url, u.role AS user_role
      FROM messages m JOIN users u ON u.id = m.user_id
      LEFT JOIN messages r ON r.id = m.reply_to_id LEFT JOIN users ru ON ru.id = r.user_id
      WHERE m.room_id = ? ORDER BY m.created_at DESC LIMIT 80`)
      .bind(roomId).all<MessageRow>();
    return Response.json({ messages: results.reverse().map(toMessage) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron recuperar los mensajes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { roomId?: string; body?: string; imageUrl?: string; replyToId?: string };
    const roomId = payload.roomId?.trim() ?? "lobby";
    const body = payload.body?.trim().slice(0, 2000) ?? "";
    const imageUrl = payload.imageUrl?.startsWith("/api/media/") ? payload.imageUrl : null;
    if (!body && !imageUrl) return Response.json({ error: "El mensaje está vacío." }, { status: 400 });
    const room = await db().prepare("SELECT id FROM rooms WHERE id = ?").bind(roomId).first();
    if (!room) return Response.json({ error: "El canal no existe." }, { status: 404 });
    const replyToId = payload.replyToId?.trim() || null;
    if (replyToId) {
      const replyTarget = await db().prepare("SELECT id FROM messages WHERE id = ? AND room_id = ? AND message_type = 'user'")
        .bind(replyToId, roomId).first();
      if (!replyTarget) return Response.json({ error: "El mensaje que intentas responder ya no existe." }, { status: 404 });
    }

    const id = crypto.randomUUID();
    await db().prepare("INSERT INTO messages (id, room_id, user_id, body, image_url, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, roomId, user.id, body, imageUrl, replyToId).run();
    const row = await db().prepare(`SELECT m.id, m.room_id, m.body, m.image_url, m.message_type,
      m.is_pinned, m.edited_at, m.created_at, r.id AS reply_id, r.body AS reply_body,
      r.image_url AS reply_image_url, ru.name AS reply_user_name,
      u.id AS user_id, u.name AS user_name, u.avatar_url, u.role AS user_role
      FROM messages m JOIN users u ON u.id = m.user_id
      LEFT JOIN messages r ON r.id = m.reply_to_id LEFT JOIN users ru ON ru.id = r.user_id
      WHERE m.id = ?`)
      .bind(id).first<MessageRow>();
    if (!row) throw new Error("El mensaje no pudo guardarse.");
    return Response.json({ message: toMessage(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo enviar el mensaje." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { messageId?: string; body?: string };
    const messageId = payload.messageId?.trim() ?? "";
    const body = payload.body?.trim().slice(0, 2000) ?? "";
    if (!messageId || !body) return Response.json({ error: "El mensaje no puede quedar vacío." }, { status: 400 });
    const target = await db().prepare("SELECT user_id, message_type FROM messages WHERE id = ? LIMIT 1")
      .bind(messageId).first<{ user_id: string; message_type: "user" | "system" }>();
    if (!target) return Response.json({ error: "El mensaje ya no existe." }, { status: 404 });
    if (target.user_id !== user.id) return Response.json({ error: "Solo puedes editar tus propios mensajes." }, { status: 403 });
    if (target.message_type !== "user") return Response.json({ error: "Este evento no se puede editar." }, { status: 400 });
    await db().prepare("UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(body, messageId).run();
    return Response.json({ ok: true, message: "Mensaje editado." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo editar el mensaje." }, { status: 500 });
  }
}
