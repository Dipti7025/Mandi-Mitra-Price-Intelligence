import { createInsertSchema } from "drizzle-zod";
import { boolean, date, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { commoditiesTable } from "./commodities";
import { mandisTable } from "./mandis";
import { varietiesTable } from "./varieties";

export const forecastsTable = pgTable("forecasts", {
  id: text("id").primaryKey(),
  commodityId: text("commodity_id").notNull().references(() => commoditiesTable.id),
  mandiId: text("mandi_id").notNull().references(() => mandisTable.id),
  varietyId: text("variety_id").references(() => varietiesTable.id),
  asOfDate: date("as_of_date", { mode: "string" }).notNull(),
  predictedPrices: jsonb("predicted_prices").$type<number[]>().notNull(),
  confidence: text("confidence"),
  modelStatus: text("model_status").notNull().default("demo"),
  isDemo: boolean("is_demo").notNull().default(true),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertForecastSchema = createInsertSchema(forecastsTable);
export type InsertForecast = typeof forecastsTable.$inferInsert;
export type ForecastRecord = typeof forecastsTable.$inferSelect;