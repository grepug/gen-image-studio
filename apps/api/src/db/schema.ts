import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);
export const providerTypeEnum = pgEnum("provider_type", ["openai-compatible"]);
export const skillStatusEnum = pgEnum("skill_status", ["active", "archived"]);
export const validationStatusEnum = pgEnum("validation_status", ["pending", "valid", "invalid"]);
export const assetKindEnum = pgEnum("asset_kind", ["skill-archive", "skill-directory", "reference-image", "output-image"]);
export const jobStatusEnum = pgEnum("job_status", ["draft", "queued", "running", "succeeded", "failed", "canceled"]);
export const jobEventTypeEnum = pgEnum("job_event_type", [
  "created",
  "queued",
  "started",
  "progress",
  "completed",
  "failed",
  "canceled"
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  ...timestamps
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  ...timestamps
}, (table) => ({
  slugUnique: uniqueIndex("workspaces_slug_unique").on(table.slug)
}));

export const workspaceMemberships = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: workspaceRoleEnum("role").notNull(),
  ...timestamps
}, (table) => ({
  userWorkspaceUnique: uniqueIndex("workspace_memberships_user_workspace_unique").on(table.userId, table.workspaceId),
  workspaceIdx: index("workspace_memberships_workspace_idx").on(table.workspaceId)
}));

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  challengeUnique: uniqueIndex("webauthn_challenges_challenge_unique").on(table.challenge)
}));

export const passkeyCredentials = pgTable("passkey_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  credentialId: text("credential_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).default(0).notNull(),
  transports: jsonb("transports").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  deviceLabel: text("device_label"),
  backedUp: boolean("backed_up").default(false).notNull(),
  ...timestamps
}, (table) => ({
  credentialUnique: uniqueIndex("passkey_credentials_credential_unique").on(table.credentialId),
  userIdx: index("passkey_credentials_user_idx").on(table.userId)
}));

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  kind: assetKindEnum("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  workspaceHashIdx: index("assets_workspace_hash_idx").on(table.workspaceId, table.sha256)
}));

export const providerProfiles = pgTable("model_provider_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  providerType: providerTypeEnum("provider_type").notNull(),
  baseUrl: text("base_url").notNull(),
  defaultModel: text("default_model").notNull(),
  defaultImageModel: text("default_image_model"),
  capabilities: jsonb("capabilities").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  ...timestamps
}, (table) => ({
  workspaceIdx: index("provider_profiles_workspace_idx").on(table.workspaceId)
}));

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: skillStatusEnum("status").default("active").notNull(),
  latestVersionId: uuid("latest_version_id"),
  ...timestamps
}, (table) => ({
  workspaceSlugUnique: uniqueIndex("skills_workspace_slug_unique").on(table.workspaceId, table.slug)
}));

export const skillVersions = pgTable("skill_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillId: uuid("skill_id").references(() => skills.id, { onDelete: "cascade" }).notNull(),
  archiveAssetId: uuid("archive_asset_id").references(() => assets.id, { onDelete: "restrict" }).notNull(),
  directoryAssetId: uuid("directory_asset_id").references(() => assets.id, { onDelete: "restrict" }),
  version: text("version").notNull(),
  metadata: jsonb("metadata").$type<{ name: string; description: string; version?: string }>().notNull(),
  permissions: jsonb("permissions").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  validationStatus: validationStatusEnum("validation_status").default("pending").notNull(),
  validationErrors: jsonb("validation_errors").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
  requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
  skillVersionId: uuid("skill_version_id").references(() => skillVersions.id, { onDelete: "set null" }),
  providerProfileId: uuid("provider_profile_id").references(() => providerProfiles.id, { onDelete: "set null" }),
  status: jobStatusEnum("status").default("draft").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  ...timestamps
}, (table) => ({
  workspaceStatusIdx: index("jobs_workspace_status_idx").on(table.workspaceId, table.status)
}));

export const jobEvents = pgTable("job_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  type: jobEventTypeEnum("type").notNull(),
  message: text("message"),
  data: jsonb("data").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  jobIdx: index("job_events_job_idx").on(table.jobId)
}));

export const outputs = pgTable("outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "restrict" }).notNull(),
  label: text("label").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMemberships),
  passkeys: many(passkeyCredentials)
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(workspaceMemberships),
  providerProfiles: many(providerProfiles),
  skills: many(skills)
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  versions: many(skillVersions)
}));

