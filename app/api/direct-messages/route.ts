import { ChatMessage, db, ensureSchema, getUserBySession, ipTag } from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

type DirectMessageRow = {
  id: string;
  body: string;
  image_url: string | null;
  edited_at: string | null;
  created_at: string;
  sender_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  sender_role: "admin" | "member";
  reply_id: string | null;
  reply_body: string | null;
  reply_image_url: string | null;
  reply_user_name: string | null;
};

type InboxDirectMessageRow = {
  id: string;
  body: string;
  image_url: string | null;
  sender_id: string;
  recipient_id: string;
  read_at: string | null;
  created_at: string;
};

type InboxUserRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  role: "admin" | "member";
  account_type: "guest" | "registered" | "admin";
  status: "active" | "kicked" | "banned";
  ip_hash: string;
  last_seen: string;
};

function toMessage(row: DirectMessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: "direct",
    body: row.body,
    imageUrl: row.image_url,
    type: "user",
    isPinned: false,
    editedAt: row.edited_at,
    replyTo: row.reply_id && row.reply_user_name ? {
      id: row.reply_id,
      body: row.reply_body || (row.reply_image_url ? "[imagen]" : "[mensaje]"),
      userName: row.reply_user_name,
    } : null,
    createdAt: row.created_at,
    user: {
      id: row.sender_id,
      name: row.sender_name,
      avatarUrl: row.sender_avatar_url,
      role: row.sender_role,
    },
  };
}

const directMessageSelect = `SELECT d.id, d.body, d.image_url, d.edited_at, d.created_at,
  s.id AS sender_id, s.name AS sender_name, s.avatar_url AS sender_avatar_url, s.role AS sender_role,
  r.id AS reply_id, r.body AS reply_body, r.image_url AS reply_image_url, ru.name AS reply_user_name
  FROM direct_messages d JOIN users s ON s.id = d.sender_id
  LEFT JOIN direct_messages r ON r.id = d.reply_to_id LEFT JOIN users ru ON ru.id = r.sender_id`;

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const otherUserId = new URL(request.url).searchParams.get("userId")?.trim() ?? "";
    if (!otherUserId) {
      const { results } = await db().prepare(`SELECT id, sender_id, recipient_id, body, image_url, read_at, created_at
        FROM direct_messages
        WHERE sender_id = ? OR recipient_id = ?
        ORDER BY created_at DESC, rowid DESC`)
        .bind(user.id, user.id).all<InboxDirectMessageRow>();
      const summaries = new Map<string, { unreadCount: number; latestMessage: InboxDirectMessageRow }>();
      for (const message of results) {
        const participantId = message.sender_id === user.id ? message.recipient_id : message.sender_id;
        const summary = summaries.get(participantId);
        if (!summary) summaries.set(participantId, { unreadCount: 0, latestMessage: message });
        if (message.recipient_id === user.id && !message.read_at) {
          summaries.get(participantId)!.unreadCount += 1;
        }
      }

      const conversations = [];
      for (const [participantId, summary] of summaries) {
        const participant = await db().prepare(`SELECT id, name, avatar_url, role, account_type, status, ip_hash, last_seen
          FROM users WHERE id = ? LIMIT 1`).bind(participantId).first<InboxUserRow>();
        if (!participant) continue;
        conversations.push({
          user: {
            id: participant.id,
            name: participant.name,
            avatarUrl: participant.avatar_url,
            role: participant.role,
            accountType: participant.account_type,
            status: participant.status,
            ipTag: ipTag(participant.ip_hash),
            lastSeen: participant.last_seen,
          },
          unreadCount: summary.unreadCount,
          latestMessage: {
            id: summary.latestMessage.id,
            body: summary.latestMessage.body,
            imageUrl: summary.latestMessage.image_url,
            senderId: summary.latestMessage.sender_id,
            createdAt: summary.latestMessage.created_at,
          },
        });
      }
      return Response.json({ conversations });
    }
    if (otherUserId === user.id) {
      return Response.json({ error: "Selecciona otra persona para abrir el canal privado." }, { status: 400 });
    }
    const participant = await db().prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(otherUserId).first();
    if (!participant) return Response.json({ error: "La persona ya no está disponible." }, { status: 404 });
    const { results } = await db().prepare(`${directMessageSelect}
      WHERE (d.sender_id = ? AND d.recipient_id = ?) OR (d.sender_id = ? AND d.recipient_id = ?)
      ORDER BY d.created_at DESC LIMIT 100`)
      .bind(user.id, otherUserId, otherUserId, user.id).all<DirectMessageRow>();
    return Response.json({ messages: results.reverse().map(toMessage) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo abrir el canal privado." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { recipientId?: string; body?: string; imageUrl?: string; replyToId?: string };
    const recipientId = payload.recipientId?.trim() ?? "";
    const body = payload.body?.trim().slice(0, 2000) ?? "";
    const imageUrl = payload.imageUrl?.startsWith("/api/media/") ? payload.imageUrl : null;
    if (!recipientId || recipientId === user.id) return Response.json({ error: "Destinatario no válido." }, { status: 400 });
    if (!body && !imageUrl) return Response.json({ error: "El mensaje está vacío." }, { status: 400 });
    const recipient = await db().prepare("SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1")
      .bind(recipientId).first();
    if (!recipient) return Response.json({ error: "La persona no está disponible para mensajes privados." }, { status: 404 });
    const replyToId = payload.replyToId?.trim() || null;
    if (replyToId) {
      const reply = await db().prepare(`SELECT id FROM direct_messages WHERE id = ? AND
        ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`)
        .bind(replyToId, user.id, recipientId, recipientId, user.id).first();
      if (!reply) return Response.json({ error: "El mensaje privado que intentas responder ya no existe." }, { status: 404 });
    }
    const id = crypto.randomUUID();
    await db().prepare(`INSERT INTO direct_messages
      (id, sender_id, recipient_id, body, image_url, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, recipientId, body, imageUrl, replyToId).run();
    const row = await db().prepare(`${directMessageSelect} WHERE d.id = ?`).bind(id).first<DirectMessageRow>();
    if (!row) throw new Error("El mensaje privado no pudo guardarse.");
    return Response.json({ message: toMessage(row) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo enviar el mensaje privado." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { action?: string; userId?: string; messageId?: string; body?: string };
    if (payload.action === "mark_read") {
      const otherUserId = payload.userId?.trim() ?? "";
      if (!otherUserId || otherUserId === user.id) {
        return Response.json({ error: "Conversacion privada no valida." }, { status: 400 });
      }
      const participant = await db().prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(otherUserId).first();
      if (!participant) return Response.json({ error: "La persona ya no esta disponible." }, { status: 404 });
      await db().prepare(`UPDATE direct_messages SET read_at = CURRENT_TIMESTAMP
        WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`)
        .bind(otherUserId, user.id).run();
      return Response.json({ ok: true });
    }
    const messageId = payload.messageId?.trim() ?? "";
    const body = payload.body?.trim().slice(0, 2000) ?? "";
    if (!messageId || !body) return Response.json({ error: "El mensaje no puede quedar vacío." }, { status: 400 });
    const target = await db().prepare("SELECT sender_id FROM direct_messages WHERE id = ? LIMIT 1")
      .bind(messageId).first<{ sender_id: string }>();
    if (!target) return Response.json({ error: "El mensaje ya no existe." }, { status: 404 });
    if (target.sender_id !== user.id) return Response.json({ error: "Solo puedes editar tus propios mensajes privados." }, { status: 403 });
    await db().prepare("UPDATE direct_messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(body, messageId).run();
    return Response.json({ ok: true, message: "Mensaje privado editado." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo editar el mensaje privado." }, { status: 500 });
  }
}
