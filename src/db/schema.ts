import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
});

export const passkeyCredentials = sqliteTable("passkey_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  transports: text("transports", { mode: "json" }).$type<
    AuthenticatorTransportFuture[]
  >(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now', 'subsec') * 1000)`),
});

export type User = typeof users.$inferSelect;
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;
