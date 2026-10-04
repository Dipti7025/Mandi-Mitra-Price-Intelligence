import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { commoditiesTable } from "./commodities";
import { mandisTable } from "./mandis";

export const varietiesTable = pgTable("varieties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  commodityId: text("commodity_id").notNull().references(() => commoditiesTable.id),
  mandiId: text("mandi_id").notNull().references(() => mandisTable.id),
}, (table) => [
  uniqueIndex("variety_market_name_unique").on(table.name, table.commodityId, table.mandiId),
]);

export const insertVarietySchema = createInsertSchema(varietiesTable);
export type InsertVariety = typeof varietiesTable.$inferInsert;
export type Variety = typeof varietiesTable.$inferSelect;