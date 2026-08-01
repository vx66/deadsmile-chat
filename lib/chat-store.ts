import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type D1Row = Record<string, unknown>;

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = D1Row>() => Promise<T | null>;
  all: <T = D1Row>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

type R2ObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  writeHttpMetadata: (headers: Headers) => void;
};

type UploadBucketLike = {
  put: (
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectLike | null>;
};

type NetworkCf = {
  city?: string;
  region?: string;
  regionCode?: string;
  country?: string;
  continent?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
};

export type ConnectionProfile = {
  ipAddress: string;
  ipHash: string;
  city: string | null;
  region: string | null;
  regionCode: string | null;
  country: string | null;
  continent: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
  asn: string | null;
  organization: string | null;
  colo: string | null;
};

export type ChatUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: "admin" | "member";
  accountType: "guest" | "registered" | "admin";
  status: "active" | "kicked" | "banned";
  ipTag: string;
  lastSeen: string;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  body: string;
  imageUrl: string | null;
  type: "user" | "system";
  isPinned: boolean;
  editedAt: string | null;
  replyTo: { id: string; body: string; userName: string } | null;
  createdAt: string;
  user: Pick<ChatUser, "id" | "name" | "avatarUrl" | "role">;
};

export type AdminUserRecord = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: ChatUser["role"];
  accountType: ChatUser["accountType"];
  status: ChatUser["status"];
  isOnline: boolean;
  ipAddress: string;
  ipTag: string;
  city: string | null;
  region: string | null;
  regionCode: string | null;
  country: string | null;
  continent: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
  asn: string | null;
  organization: string | null;
  colo: string | null;
  firstSeen: string;
  lastSeen: string;
};

let schemaReady: Promise<void> | null = null;
let localDatabase: D1DatabaseLike | null = null;
let localUploads: UploadBucketLike | null = null;

class LocalStatement implements D1Statement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async first<T = D1Row>() {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T = D1Row>() {
    return { results: this.database.prepare(this.query).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.query).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class LocalDatabase implements D1DatabaseLike {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string) {
    return new LocalStatement(this.database, query);
  }

  async batch(statements: D1Statement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) await statement.run();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function dataDirectory() {
  return resolve(process.env.DATA_DIR ?? "./data");
}

function createLocalDatabase() {
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "dead-smile-chat.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  return new LocalDatabase(database);
}

const imageContentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function uploadPath(key: string) {
  const segments = key.replaceAll("\\", "/").split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Ruta de imagen no válida.");
  }
  return join(dataDirectory(), "uploads", ...segments);
}

function createLocalUploads(): UploadBucketLike {
  return {
    async put(key, value) {
      const path = uploadPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(value));
    },
    async get(key) {
      try {
        const path = uploadPath(key);
        const contents = await readFile(path);
        const contentType = imageContentTypes.get(extname(path).toLowerCase());
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(contents));
            controller.close();
          },
        });
        return {
          body,
          httpMetadata: { contentType },
          writeHttpMetadata(headers) {
            if (contentType) headers.set("Content-Type", contentType);
          },
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

export function db() {
  localDatabase ??= createLocalDatabase();
  return localDatabase;
}

export function uploads() {
  localUploads ??= createLocalUploads();
  return localUploads;
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = initializeSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function initializeSchema() {
  const d1 = db();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      password_hash TEXT,
      ip_hash TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      account_type TEXT NOT NULL DEFAULT 'guest',
      status TEXT NOT NULL DEFAULT 'active',
      city TEXT,
      region TEXT,
      region_code TEXT,
      country TEXT,
      continent TEXT,
      postal_code TEXT,
      latitude TEXT,
      longitude TEXT,
      timezone TEXT,
      asn TEXT,
      organization TEXT,
      colo TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_name_unique ON users(name COLLATE NOCASE)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL"),
    d1.prepare("CREATE INDEX IF NOT EXISTS users_ip_idx ON users(ip_hash)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      message_type TEXT NOT NULL DEFAULT 'user',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      edited_at TEXT,
      reply_to_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages(room_id, created_at)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      reply_to_id TEXT,
      edited_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS direct_messages_sender_recipient_idx ON direct_messages(sender_id, recipient_id, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS direct_messages_recipient_sender_idx ON direct_messages(recipient_id, sender_id, created_at)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS bans (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);

  const columns = await d1.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const present = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["password_hash", "ALTER TABLE users ADD COLUMN password_hash TEXT"],
    ["ip_address", "ALTER TABLE users ADD COLUMN ip_address TEXT NOT NULL DEFAULT ''"],
    ["city", "ALTER TABLE users ADD COLUMN city TEXT"],
    ["region", "ALTER TABLE users ADD COLUMN region TEXT"],
    ["region_code", "ALTER TABLE users ADD COLUMN region_code TEXT"],
    ["country", "ALTER TABLE users ADD COLUMN country TEXT"],
    ["continent", "ALTER TABLE users ADD COLUMN continent TEXT"],
    ["postal_code", "ALTER TABLE users ADD COLUMN postal_code TEXT"],
    ["latitude", "ALTER TABLE users ADD COLUMN latitude TEXT"],
    ["longitude", "ALTER TABLE users ADD COLUMN longitude TEXT"],
    ["timezone", "ALTER TABLE users ADD COLUMN timezone TEXT"],
    ["asn", "ALTER TABLE users ADD COLUMN asn TEXT"],
    ["organization", "ALTER TABLE users ADD COLUMN organization TEXT"],
    ["colo", "ALTER TABLE users ADD COLUMN colo TEXT"],
    ["is_online", "ALTER TABLE users ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0"],
  ] as const;
  const missingStatements = additions
    .filter(([name]) => !present.has(name))
    .map(([, statement]) => d1.prepare(statement));
  if (missingStatements.length) await d1.batch(missingStatements);

  const messageColumns = await d1.prepare("PRAGMA table_info(messages)").all<{ name: string }>();
  const presentMessageColumns = new Set(messageColumns.results.map((column) => column.name));
  const messageAdditions = [
    ["message_type", "ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'user'"],
    ["is_pinned", "ALTER TABLE messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"],
    ["edited_at", "ALTER TABLE messages ADD COLUMN edited_at TEXT"],
    ["reply_to_id", "ALTER TABLE messages ADD COLUMN reply_to_id TEXT"],
  ] as const;
  const missingMessageStatements = messageAdditions
    .filter(([name]) => !presentMessageColumns.has(name))
    .map(([, statement]) => d1.prepare(statement));
  if (missingMessageStatements.length) await d1.batch(missingMessageStatements);

  const directMessageColumns = await d1.prepare("PRAGMA table_info(direct_messages)").all<{ name: string }>();
  const presentDirectMessageColumns = new Set(directMessageColumns.results.map((column) => column.name));
  if (!presentDirectMessageColumns.has("read_at")) {
    await d1.prepare("ALTER TABLE direct_messages ADD COLUMN read_at TEXT").run();
  }

  await d1.batch([
    d1.prepare("DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE account_type = 'bot')"),
    d1.prepare("DELETE FROM users WHERE account_type = 'bot'"),
    d1.prepare("DELETE FROM messages WHERE id IN ('seed-1', 'seed-2', 'seed-3')"),
    d1.prepare("INSERT OR IGNORE INTO rooms (id, name, description, icon) VALUES ('lobby', 'deadchat', 'Canal principal de Dead Smile Chat.', '#')"),
    d1.prepare("UPDATE rooms SET name = 'deadchat', description = 'Canal principal de Dead Smile Chat.' WHERE id = 'lobby'"),
  ]);
}

export async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(`dead-smile-chat::${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1"
  );
}

export async function connectionProfileFor(request: Request): Promise<ConnectionProfile> {
  const ipAddress = requestIp(request);
  const cf = (request as Request & { cf?: NetworkCf }).cf;
  return {
    ipAddress,
    ipHash: await hashValue(ipAddress),
    city: cf?.city ?? null,
    region: cf?.region ?? null,
    regionCode: cf?.regionCode ?? null,
    country: cf?.country ?? null,
    continent: cf?.continent ?? null,
    postalCode: cf?.postalCode ?? null,
    latitude: cf?.latitude ?? null,
    longitude: cf?.longitude ?? null,
    timezone: cf?.timezone ?? null,
    asn: cf?.asn ? String(cf.asn) : null,
    organization: cf?.asOrganization ?? null,
    colo: cf?.colo ?? null,
  };
}

export function connectionBindValues(profile: ConnectionProfile) {
  return [
    profile.ipHash,
    profile.ipAddress,
    profile.city,
    profile.region,
    profile.regionCode,
    profile.country,
    profile.continent,
    profile.postalCode,
    profile.latitude,
    profile.longitude,
    profile.timezone,
    profile.asn,
    profile.organization,
    profile.colo,
  ];
}

export async function verifyAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD ?? (process.env.NODE_ENV === "production" ? null : "xergno@404");
  if (!expected) return false;
  const [actualHash, expectedHash] = await Promise.all([hashValue(password), hashValue(expected)]);
  if (actualHash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

export function assertRuntimeConfiguration() {
  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD no está configurada.");
  }
}

export async function createPasswordHash(password: string) {
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, saltHex, keyHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;
  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await derivePasswordKey(password, Buffer.from(saltHex, "hex"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function derivePasswordKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function ipTag(ipHash: string) {
  return `••••-${ipHash.slice(-6).toUpperCase()}`;
}

export function publicUser(row: {
  id: string;
  name: string;
  avatar_url: string | null;
  role: ChatUser["role"];
  account_type: ChatUser["accountType"];
  status: ChatUser["status"];
  ip_hash: string;
  last_seen: string;
}): ChatUser {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    accountType: row.account_type,
    status: row.status,
    ipTag: ipTag(row.ip_hash),
    lastSeen: row.last_seen,
  };
}

export async function getUserBySession(request: Request) {
  await ensureSchema();
  const token = cookieValue(request, "dead_smile_session");
  if (!token) return null;
  const tokenHash = await hashValue(token);
  const row = await db().prepare(`SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1`).bind(tokenHash).first<{
      id: string;
      name: string;
      avatar_url: string | null;
      role: ChatUser["role"];
      account_type: ChatUser["accountType"];
      status: ChatUser["status"];
      ip_hash: string;
      last_seen: string;
      is_online: number;
      email: string | null;
    }>();
  if (!row || row.status !== "active") return null;
  await markUserOnline(row.id, row.name);
  const profile = await connectionProfileFor(request);
  await db().prepare(`UPDATE users SET last_seen = CURRENT_TIMESTAMP,
    ip_hash = ?, ip_address = ?, city = COALESCE(?, city), region = COALESCE(?, region),
    region_code = COALESCE(?, region_code), country = COALESCE(?, country), continent = COALESCE(?, continent),
    postal_code = COALESCE(?, postal_code), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
    timezone = COALESCE(?, timezone), asn = COALESCE(?, asn), organization = COALESCE(?, organization), colo = COALESCE(?, colo)
    WHERE id = ?`).bind(...connectionBindValues(profile), row.id).run();
  return { ...publicUser({ ...row, ip_hash: profile.ipHash, last_seen: new Date().toISOString() }), email: row.email };
}

export async function createSession(userId: string, request: Request) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const tokenHash = await hashValue(token);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db().prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expires).run();
  const secure = requestUsesHttps(request) ? "; Secure" : "";
  return `dead_smile_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = requestUsesHttps(request) ? "; Secure" : "";
  return `dead_smile_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function requestUsesHttps(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

export function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export async function listMembers() {
  await ensureSchema();
  const stale = await db().prepare(`SELECT id, name FROM users
    WHERE status = 'active' AND is_online = 1 AND datetime(last_seen) < datetime('now', '-60 seconds')`)
    .all<{ id: string; name: string }>();
  for (const member of stale.results) await markUserOffline(member.id, member.name);
  const { results } = await db().prepare(`SELECT id, name, avatar_url, role, account_type, status, ip_hash, last_seen
    FROM users
    WHERE status = 'active' AND is_online = 1 AND datetime(last_seen) >= datetime('now', '-60 seconds')
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE`).all<{
      id: string;
      name: string;
      avatar_url: string | null;
      role: ChatUser["role"];
      account_type: ChatUser["accountType"];
      status: ChatUser["status"];
      ip_hash: string;
      last_seen: string;
    }>();
  return results.map(publicUser);
}

export async function markUserOnline(userId: string, name: string) {
  const result = await db().prepare(`UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'active' AND is_online = 0`).bind(userId).run();
  if ((result.meta?.changes ?? 0) > 0) {
    await db().prepare(`INSERT INTO messages
      (id, room_id, user_id, body, message_type) VALUES (?, 'lobby', ?, ?, 'system')`)
      .bind(crypto.randomUUID(), userId, `${name} se ha conectado.`).run();
  }
}

export async function markUserOffline(userId: string, name: string) {
  const result = await db().prepare("UPDATE users SET is_online = 0 WHERE id = ? AND is_online = 1")
    .bind(userId).run();
  if ((result.meta?.changes ?? 0) > 0) {
    await db().prepare(`INSERT INTO messages
      (id, room_id, user_id, body, message_type) VALUES (?, 'lobby', ?, ?, 'system')`)
      .bind(crypto.randomUUID(), userId, `${name} se ha desconectado.`).run();
  }
}

export function sanitizeName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 22);
}

export function validName(value: string) {
  return /^[\p{L}\p{N}_. -]{2,22}$/u.test(value) && value.toLocaleLowerCase() !== "xergno";
}
