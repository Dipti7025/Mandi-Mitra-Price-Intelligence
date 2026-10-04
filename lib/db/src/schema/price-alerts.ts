import { createInsertSchema } from "drizzle-zod";
import { boolean, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { commoditiesTable } from "./commodities";
import { mandisTable } from "./mandis";
import { usersTable } from "./users";

export const priceAlertsTable = pgTable("price_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  commodityId: text("commodity_id").notNull().references(() => commoditiesTable.id),
  mandiId: text("mandi_id").notNull().references(() => mandisTable.id),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }).notNull(),
  direction: text("direction").notNull(),
  channel: text("channel").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("price_alert_user_id_idx").on(table.userId)]);

export const insertPriceAlertSchema = createInsertSchema(priceAlertsTable).omit({ createdAt: true });
export type InsertPriceAlert = typeof priceAlertsTable.$inferInsert;
export type PriceAlertRecord = typeof priceAlertsTable.$inferSelect;