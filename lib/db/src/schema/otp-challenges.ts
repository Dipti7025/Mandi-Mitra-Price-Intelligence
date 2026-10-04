import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const otpChallengesTable = pgTable("otp_challenges", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("otp_phone_created_idx").on(table.phone, table.createdAt)]);

export const insertOtpChallengeSchema = createInsertSchema(otpChallengesTable).omit({ createdAt: true });
export type InsertOtpChallenge = typeof otpChallengesTable.$inferInsert;
export type OtpChallenge = typeof otpChallengesTable.$inferSelect;