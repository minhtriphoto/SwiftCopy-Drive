import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Firebase UID
  email: text("email").notNull().unique(),
  name: text("name"),
  picture: text("picture"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiryDate: integer("expiry_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  darkMode: boolean("dark_mode").default(false),
  language: text("language").default("en"),
  retryCount: integer("retry_count").default(3),
  concurrentThreads: integer("concurrent_threads").default(3),
  notification: boolean("notification").default(true),
});

export const cloneJobs = pgTable("clone_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  sourceUrl: text("source_url").notNull(),
  sourceId: text("source_id"),
  destinationId: text("destination_id"),
  status: text("status").notNull(), // PENDING, SCANNING, COPYING, COMPLETED, FAILED, PAUSED
  totalFiles: integer("total_files").default(0),
  copiedFiles: integer("copied_files").default(0),
  skippedFiles: integer("skipped_files").default(0),
  failedFiles: integer("failed_files").default(0),
  totalSize: integer("total_size").default(0),
  copiedSize: integer("copied_size").default(0),
  elapsedTime: integer("elapsed_time").default(0),
  options: jsonb("options"), // filters, duplicate handling, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cloneLogs = pgTable("clone_logs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => cloneJobs.id),
  type: text("type").notNull(), // INFO, SUCCESS, ERROR, SKIP, RETRY
  message: text("message").notNull(),
  fileId: text("file_id"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").defaultNow(),
});
