import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const importJobsTable = pgTable("import_jobs", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").references(() => usersTable.id),
  status: text("status").notNull().default("pending"),
  importedCount: integer("imported_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportJobSchema = createInsertSchema(importJobsTable).omit({ createdAt: true });
export type InsertImportJob = typeof importJobsTable.$inferInsert;
export type ImportJob = typeof importJobsTable.$inferSelect;