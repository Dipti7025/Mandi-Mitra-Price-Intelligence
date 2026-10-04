import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { commoditiesTable } from "./commodities";
import { mandisTable } from "./mandis";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  preferredCommodityId: text("preferred_commodity_id").references(() => commoditiesTable.id),
  preferredMandiId: text("preferred_mandi_id").references(() => mandisTable.id),
  role: text("role").notNull().default("farmer"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;