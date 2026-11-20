import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const beneficiaries = pgTable("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  plan: varchar("plan", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  accessUntil: varchar("access_until", { length: 100 }).notNull(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }).notNull(),
  accessScope: varchar("access_scope", { length: 255 }).notNull(),
  securityStatus: varchar("security_status", { length: 100 }).notNull(),
});

export type BeneficiaryRow = typeof beneficiaries.$inferSelect;

export type TeamMemberRow = typeof teamMembers.$inferSelect;
