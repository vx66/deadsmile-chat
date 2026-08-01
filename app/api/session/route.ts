import {
  clearSessionCookie,
  connectionBindValues,
  connectionProfileFor,
  createPasswordHash,
  createSession,
  db,
  ensureSchema,
  getUserBySession,
  listMembers,
  markUserOffline,
  markUserOnline,
  publicUser,
  sanitizeName,
  validName,
  verifyAdminPassword,
  verifyPassword,
} from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  account_type: "guest" | "registered" | "admin";
  status: "active" | "kicked" | "banned";
  ip_hash: string;
  last_seen: string;
};

const connectionColumns = `ip_hash = ?, ip_address = ?, city = COALESCE(?, city), region = COALESCE(?, region),
  region_code = COALESCE(?, region_code), country = COALESCE(?, country), continent = COALESCE(?, continent),
  postal_code = COALESCE(?, postal_code), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
  timezone = COALESCE(?, timezone), asn = COALESCE(?, asn), organization = COALESCE(?, organization), colo = COALESCE(?, colo)`;

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await getUserBySession(request);
    const members = await listMembers();
    return Response.json({ user, members });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No fue posible abrir la señal." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      mode?: "guest" | "registered" | "admin";
      name?: string;
      username?: string;
      email?: string;
      password?: string;
      action?: "signup" | "login";
    };
    const profile = await connectionProfileFor(request);

    if (payload.mode === "admin") {
      const username = payload.username?.trim().toLocaleLowerCase() ?? "";
      const validPassword = await verifyAdminPassword(payload.password ?? "");
      if (username !== "xergno" || !validPassword) {
        return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }

      let admin = await db().prepare("SELECT * FROM users WHERE name = 'xergno' COLLATE NOCASE LIMIT 1").first<UserRow>();
      if (!admin) {
        const id = `admin-${crypto.randomUUID()}`;
        await db().prepare(`INSERT INTO users
          (id, name, email, ip_hash, ip_address, city, region, region_code, country, continent, postal_code,
           latitude, longitude, timezone, asn, organization, colo, role, account_type, status, last_seen)
          VALUES (?, 'xergno', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin', 'active', CURRENT_TIMESTAMP)`)
          .bind(id, ...connectionBindValues(profile)).run();
        admin = await db().prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
      } else {
        await db().prepare(`UPDATE users SET ${connectionColumns}, role = 'admin', account_type = 'admin', status = 'active', last_seen = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(...connectionBindValues(profile), admin.id).run();
        admin = await db().prepare("SELECT * FROM users WHERE id = ?").bind(admin.id).first<UserRow>();
      }
      if (!admin) throw new Error("No fue posible iniciar la consola administrativa.");
      const cookie = await createSession(admin.id, request);
      await markUserOnline(admin.id, admin.name);
      return Response.json({ user: publicUser(admin) }, { status: 201, headers: { "Set-Cookie": cookie } });
    }

    const banned = await db().prepare("SELECT id FROM bans WHERE ip_hash = ? LIMIT 1").bind(profile.ipHash).first();
    if (banned) {
      return Response.json({ error: "Esta conexión está bloqueada por un administrador." }, { status: 403 });
    }

    if (payload.mode === "registered") {
      const email = payload.email?.trim().toLocaleLowerCase() ?? "";
      const password = payload.password ?? "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return Response.json({ error: "Escribe un correo válido." }, { status: 400 });
      }
      if (password.length < 10 || password.length > 128) {
        return Response.json({ error: "La contraseña debe tener entre 10 y 128 caracteres." }, { status: 400 });
      }

      if (payload.action === "login") {
        let existing = await db().prepare("SELECT * FROM users WHERE email = ? AND account_type = 'registered' LIMIT 1")
          .bind(email).first<UserRow>();
        if (!existing || !(await verifyPassword(password, existing.password_hash))) {
          return Response.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
        }
        if (existing.status === "banned") {
          return Response.json({ error: "Tu cuenta está bloqueada." }, { status: 403 });
        }
        await db().prepare(`UPDATE users SET ${connectionColumns}, status = 'active', last_seen = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(...connectionBindValues(profile), existing.id).run();
        existing = await db().prepare("SELECT * FROM users WHERE id = ?").bind(existing.id).first<UserRow>();
        if (!existing) throw new Error("No fue posible recuperar la cuenta.");
        const cookie = await createSession(existing.id, request);
        await markUserOnline(existing.id, existing.name);
        return Response.json({ user: publicUser(existing) }, { headers: { "Set-Cookie": cookie } });
      }

      const name = sanitizeName(payload.name ?? "");
      if (!validName(name)) {
        return Response.json({ error: "El alias debe tener entre 2 y 22 caracteres válidos." }, { status: 400 });
      }
      const existing = await db().prepare("SELECT id FROM users WHERE email = ? OR name = ? COLLATE NOCASE LIMIT 1")
        .bind(email, name).first();
      if (existing) return Response.json({ error: "Ese correo o alias ya está registrado." }, { status: 409 });

      const id = crypto.randomUUID();
      const passwordHash = await createPasswordHash(password);
      await db().prepare(`INSERT INTO users
        (id, name, email, password_hash, ip_hash, ip_address, city, region, region_code, country, continent, postal_code,
         latitude, longitude, timezone, asn, organization, colo, role, account_type, status, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', 'registered', 'active', CURRENT_TIMESTAMP)`)
        .bind(id, name, email, passwordHash, ...connectionBindValues(profile)).run();
      const registered = await db().prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
      if (!registered) throw new Error("No fue posible crear la cuenta.");
      const cookie = await createSession(registered.id, request);
      await markUserOnline(registered.id, registered.name);
      return Response.json({ user: publicUser(registered) }, { status: 201, headers: { "Set-Cookie": cookie } });
    }

    const name = sanitizeName(payload.name ?? "");
    if (!validName(name)) {
      return Response.json(
        { error: name.toLocaleLowerCase() === "xergno" ? "Ese alias está reservado al administrador." : "Usa entre 2 y 22 letras, números, espacios, puntos, guiones o _." },
        { status: 400 },
      );
    }

    let byIp = await db().prepare("SELECT * FROM users WHERE ip_hash = ? AND account_type != 'admin' ORDER BY created_at DESC LIMIT 1")
      .bind(profile.ipHash).first<UserRow>();

    if (byIp) {
      if (byIp.status === "banned") {
        return Response.json({ error: "Esta conexión fue baneada." }, { status: 403 });
      }
      if (byIp.name.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
        return Response.json(
          { error: `Esta conexión ya pertenece a ${byIp.name}. Usa ese mismo nombre.` },
          { status: 409 },
        );
      }
      await db().prepare(`UPDATE users SET ${connectionColumns}, status = 'active', last_seen = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...connectionBindValues(profile), byIp.id).run();
      byIp = await db().prepare("SELECT * FROM users WHERE id = ?").bind(byIp.id).first<UserRow>();
      if (!byIp) throw new Error("No fue posible recuperar el usuario.");
      const cookie = await createSession(byIp.id, request);
      await markUserOnline(byIp.id, byIp.name);
      return Response.json({ user: publicUser(byIp) }, { headers: { "Set-Cookie": cookie } });
    }

    const taken = await db().prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE LIMIT 1").bind(name).first();
    if (taken) {
      return Response.json({ error: "Ese alias ya está conectado. Elige otro." }, { status: 409 });
    }

    const id = crypto.randomUUID();
    await db().prepare(`INSERT INTO users
      (id, name, ip_hash, ip_address, city, region, region_code, country, continent, postal_code,
       latitude, longitude, timezone, asn, organization, colo, role, account_type, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', 'guest', 'active', CURRENT_TIMESTAMP)`)
      .bind(id, name, ...connectionBindValues(profile)).run();
    const row = await db().prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
    if (!row) throw new Error("No fue posible crear el usuario.");
    const cookie = await createSession(id, request);
    await markUserOnline(row.id, row.name);
    return Response.json({ user: publicUser(row) }, { status: 201, headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "La conexión fue rechazada." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const payload = (await request.json()) as { avatarUrl?: string };
    if (payload.avatarUrl?.startsWith("/api/media/")) {
      await db().prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(payload.avatarUrl, user.id).run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el perfil." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getUserBySession(request);
  if (user) {
    await markUserOffline(user.id, user.name);
    await db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
