import { createInsertSchema } from "drizzle-zod";
import { boolean, doublePrecision, pgTable, text } from "drizzle-orm/pg-core";
import { statesTable } from "./states";

export const mandisTable = pgTable("mandis", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stateId: text("state_id").notNull().references(() => statesTable.id),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  enabled: boolean("enabled").notNull().default(true),
});

export const insertMandiSchema = createInsertSchema(mandisTable);
export type InsertMandi = typeof mandisTable.$inferInsert;
export type Mandi = typeof mandisTable.$inferSelect;