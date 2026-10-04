import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const commoditiesTable = pgTable("commodities", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommoditySchema = createInsertSchema(commoditiesTable).omit({ createdAt: true });
export type InsertCommodity = typeof commoditiesTable.$inferInsert;
export type Commodity = typeof commoditiesTable.$inferSelect;