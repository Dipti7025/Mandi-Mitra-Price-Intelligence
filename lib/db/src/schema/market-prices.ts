import { createInsertSchema } from "drizzle-zod";
import { boolean, date, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { commoditiesTable } from "./commodities";
import { mandisTable } from "./mandis";
import { varietiesTable } from "./varieties";

export const marketPricesTable = pgTable("market_prices", {
  id: text("id").primaryKey(),
  commodityId: text("commodity_id").notNull().references(() => commoditiesTable.id),
  mandiId: text("mandi_id").notNull().references(() => mandisTable.id),
  varietyId: text("variety_id").references(() => varietiesTable.id),
  marketDate: date("market_date", { mode: "string" }).notNull(),
  minimumPrice: numeric("minimum_price", { precision: 12, scale: 2 }).notNull(),
  maximumPrice: numeric("maximum_price", { precision: 12, scale: 2 }).notNull(),
  modalPrice: numeric("modal_price", { precision: 12, scale: 2 }).notNull(),
  arrivals: numeric("arrivals", { precision: 14, scale: 2 }).notNull(),
  arrivalUnit: text("arrival_unit").notNull().default("tonnes"),
  unit: text("unit").notNull().default("quintal"),
  changePercent: numeric("change_percent", { precision: 7, scale: 2 }).notNull().default("0"),
  source: text("source").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_price_day_unique").on(table.commodityId, table.mandiId, table.varietyId, table.marketDate),
  index("market_price_market_date_idx").on(table.commodityId, table.mandiId, table.marketDate),
]);

export const insertMarketPriceSchema = createInsertSchema(marketPricesTable);
export type InsertMarketPrice = typeof marketPricesTable.$inferInsert;
export type MarketPrice = typeof marketPricesTable.$inferSelect;