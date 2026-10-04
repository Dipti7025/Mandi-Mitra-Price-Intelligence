import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const adminUsersTable = pgTable("admin_users", {
  userId: text("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({ createdAt: true });
export type InsertAdminUser = typeof adminUsersTable.$inferInsert;
export type AdminUser = typeof adminUsersTable.$inferSelect;