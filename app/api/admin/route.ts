import {
  AdminUserRecord,
  ChatMessage,
  db,
  ensureSchema,
  getUserBySession,
  ipTag,
  markUserOffline,
} from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

type AdminRow = {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  account_type: "guest" | "registered" | "admin";
  status: "active" | "kicked" | "banned";
  ip_hash: string;
  ip_address: string;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  continent: string | null;
  postal_code: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
  asn: string | null;
  organization: string | null;
  colo: string | null;
  created_at: string;
  last_seen: string;
  is_online: number;
};

type AdminMessageRow = {
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

function toAdminRecord(row: AdminRow): AdminUserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    accountType: row.account_type,
    status: row.status,
    isOnline: row.is_online === 1,
    ipAddress: row.ip_address || "No disponible",
    ipTag: ipTag(row.ip_hash),
    city: row.city,
    region: row.region,
    regionCode: row.region_code,
    country: row.country,
    continent: row.continent,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    asn: row.asn,
    organization: row.organization,
    colo: row.colo,
    firstSeen: row.created_at,
    lastSeen: row.last_seen,
  };
}

function toMessage(row: AdminMessageRow): ChatMessage {
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
      body: row.reply_body || (row.reply_image_url ? "[imagen]" : "[mensaje]"),
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
    const admin = await getUserBySession(request);
    if (!admin || admin.role !== "admin") {
      return Response.json({ error: "Acceso reservado al administrador." }, { status: 403 });
    }
    const { results } = await db().prepare(`SELECT id, name, email, avatar_url, role, account_type, status,
      ip_hash, ip_address, city, region, region_code, country, continent, postal_code, latitude, longitude,
      timezone, asn, organization, colo, created_at, last_seen,
      CASE WHEN status = 'active' AND is_online = 1 AND datetime(last_seen) >= datetime('now', '-60 seconds') THEN 1 ELSE 0 END AS is_online
      FROM users ORDER BY datetime(last_seen) DESC, name COLLATE NOCASE`).all<AdminRow>();
    const users = results.map(toAdminRecord);
    const messageRows = await db().prepare(`SELECT m.id, m.room_id, m.body, m.image_url, m.message_type,
      m.is_pinned, m.edited_at, m.created_at, r.id AS reply_id, r.body AS reply_body,
      r.image_url AS reply_image_url, ru.name AS reply_user_name, u.id AS user_id, u.name AS user_name,
      u.avatar_url, u.role AS user_role
      FROM messages m JOIN users u ON u.id = m.user_id
      LEFT JOIN messages r ON r.id = m.reply_to_id LEFT JOIN users ru ON ru.id = r.user_id
      ORDER BY m.created_at DESC LIMIT 200`).all<AdminMessageRow>();
    const online = results.filter((item) => item.is_online === 1).length;
    return Response.json({
      users,
      messages: messageRows.results.map(toMessage),
      stats: {
        total: users.length,
        online,
        banned: users.filter((item) => item.status === "banned").length,
        countries: new Set(users.map((item) => item.country).filter(Boolean)).size,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo abrir el dashboard." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const admin = await getUserBySession(request);
    if (!admin || admin.role !== "admin") {
      return Response.json({ error: "Acceso reservado al administrador." }, { status: 403 });
    }
    const payload = (await request.json()) as {
      action?: "kick" | "ban" | "block_ip" | "restore" | "clear_chat" | "delete_message" | "edit_message" | "toggle_pin";
      userId?: string;
      messageId?: string;
      body?: string;
    };

    if (payload.action === "clear_chat") {
      await db().prepare("DELETE FROM messages").run();
      return Response.json({ ok: true, message: "Se eliminó todo el historial del canal." });
    }

    if (payload.action === "delete_message" && payload.messageId) {
      await db().prepare("DELETE FROM messages WHERE id = ?").bind(payload.messageId).run();
      return Response.json({ ok: true, message: "Mensaje eliminado." });
    }

    if (payload.action === "edit_message" && payload.messageId) {
      const body = payload.body?.trim().slice(0, 2000) ?? "";
      if (!body) return Response.json({ error: "El mensaje no puede quedar vacío." }, { status: 400 });
      await db().prepare(`UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP
        WHERE id = ? AND message_type = 'user'`).bind(body, payload.messageId).run();
      return Response.json({ ok: true, message: "Mensaje editado por el administrador." });
    }

    if (payload.action === "toggle_pin" && payload.messageId) {
      await db().prepare(`UPDATE messages SET is_pinned = CASE is_pinned WHEN 1 THEN 0 ELSE 1 END
        WHERE id = ? AND message_type = 'user'`).bind(payload.messageId).run();
      return Response.json({ ok: true, message: "Estado fijado actualizado." });
    }

    if (!payload.userId || payload.userId === admin.id) {
      return Response.json({ error: "No puedes moderar esta identidad." }, { status: 400 });
    }
    const target = await db().prepare("SELECT id, name, ip_hash, role FROM users WHERE id = ? LIMIT 1")
      .bind(payload.userId).first<{ id: string; name: string; ip_hash: string; role: string }>();
    if (!target || target.role === "admin") {
      return Response.json({ error: "Esta identidad no admite moderación." }, { status: 400 });
    }

    if (payload.action === "kick") {
      await markUserOffline(target.id, target.name);
      await db().batch([
        db().prepare("UPDATE users SET status = 'kicked', is_online = 0 WHERE id = ?").bind(target.id),
        db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
      ]);
      return Response.json({ ok: true, message: "Usuario expulsado del canal." });
    }

    if (payload.action === "ban" || payload.action === "block_ip") {
      const reason = payload.action === "block_ip" ? "IP bloqueada por xergno" : "Usuario baneado por xergno";
      await markUserOffline(target.id, target.name);
      await db().batch([
        db().prepare("INSERT OR REPLACE INTO bans (id, ip_hash, reason) VALUES (?, ?, ?)").bind(crypto.randomUUID(), target.ip_hash, reason),
        db().prepare("UPDATE users SET status = 'banned', is_online = 0 WHERE id = ?").bind(target.id),
        db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
      ]);
      return Response.json({ ok: true, message: payload.action === "block_ip" ? "Dirección IP bloqueada." : "Usuario baneado." });
    }

    if (payload.action === "restore") {
      await db().batch([
        db().prepare("DELETE FROM bans WHERE ip_hash = ?").bind(target.ip_hash),
        db().prepare("UPDATE users SET status = 'active', is_online = 0 WHERE id = ?").bind(target.id),
      ]);
      return Response.json({ ok: true, message: "Acceso restaurado." });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "La orden de moderación falló." }, { status: 500 });
  }
}
