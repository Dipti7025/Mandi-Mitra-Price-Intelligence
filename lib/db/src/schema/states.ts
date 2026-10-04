import { createInsertSchema } from "drizzle-zod";
import { pgTable, text } from "drizzle-orm/pg-core";

export const statesTable = pgTable("states", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
});

export const insertStateSchema = createInsertSchema(statesTable);
export type InsertState = typeof statesTable.$inferInsert;
export type State = typeof statesTable.$inferSelect;