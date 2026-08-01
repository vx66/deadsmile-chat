import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    ipHash: text("ip_hash").notNull(),
    ipAddress: text("ip_address").notNull().default(""),
    avatarUrl: text("avatar_url"),
    role: text("role").notNull().default("member"),
    accountType: text("account_type").notNull().default("guest"),
    status: text("status").notNull().default("active"),
    city: text("city"),
    region: text("region"),
    regionCode: text("region_code"),
    country: text("country"),
    continent: text("continent"),
    postalCode: text("postal_code"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    timezone: text("timezone"),
    asn: text("asn"),
    organization: text("organization"),
    colo: text("colo"),
    isOnline: integer("is_online", { mode: "boolean" }).notNull().default(false),
    lastSeen: text("last_seen").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("users_name_unique").on(table.name),
    uniqueIndex("users_email_unique").on(table.email),
    index("users_ip_idx").on(table.ipHash),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    userId: text("user_id").notNull(),
    body: text("body").notNull().default(""),
    imageUrl: text("image_url"),
    messageType: text("message_type").notNull().default("user"),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    editedAt: text("edited_at"),
    replyToId: text("reply_to_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("messages_room_created_idx").on(table.roomId, table.createdAt)],
);

export const directMessages = sqliteTable(
  "direct_messages",
  {
    id: text("id").primaryKey(),
    senderId: text("sender_id").notNull(),
    recipientId: text("recipient_id").notNull(),
    body: text("body").notNull().default(""),
    imageUrl: text("image_url"),
    replyToId: text("reply_to_id"),
    editedAt: text("edited_at"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("direct_messages_sender_recipient_idx").on(table.senderId, table.recipientId, table.createdAt),
    index("direct_messages_recipient_sender_idx").on(table.recipientId, table.senderId, table.createdAt),
  ],
);

export const bans = sqliteTable("bans", {
  id: text("id").primaryKey(),
  ipHash: text("ip_hash").notNull().unique(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
