import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../db/db.module";
import { providerProfiles } from "../db/schema";
import { AppDb } from "../db/types";
import { isoNow } from "../common/date";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProviderProfile, ProviderProfileInput, ProviderProfileUpdateInput, ProviderTypeGql } from "./provider-profile.types";

const providerProfileInputSchema = z.object({
  workspaceId: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  providerType: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1).max(120),
  defaultImageModel: z.string().min(1).max(120).optional(),
  capabilities: z.array(z.string()),
  apiKey: z.string().min(1)
});

const providerProfileUpdateSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1).max(120),
  defaultImageModel: z.string().min(1).max(120).optional(),
  capabilities: z.array(z.string()),
  apiKey: z.string().min(1).optional()
});

type StoredProviderProfile = ProviderProfile & {
  encryptedApiKey: string;
};

@Injectable()
export class ProviderProfilesService {
  constructor(
    private readonly workspaces: WorkspacesService,
    @Inject(DB) private readonly db: AppDb
  ) {}

  async create(input: ProviderProfileInput, userId: string): Promise<ProviderProfile> {
    await this.assertWorkspaceMember(input.workspaceId, userId);
    providerProfileInputSchema.parse({
      ...input,
      providerType: "openai-compatible"
    });
    const [profile] = await this.db
      .insert(providerProfiles)
      .values({
        workspaceId: input.workspaceId,
        ownerId: userId,
        displayName: input.displayName,
        providerType: "openai-compatible",
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        defaultImageModel: input.defaultImageModel,
        capabilities: input.capabilities,
        encryptedApiKey: this.encryptForStorage(input.apiKey)
      })
      .returning();
    if (!profile) {
      throw new Error("Provider profile creation failed");
    }
    return this.toProviderProfile(profile);
  }

  async list(workspaceId: string, userId: string): Promise<ProviderProfile[]> {
    await this.assertWorkspaceMember(workspaceId, userId);
    const rows = await this.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.workspaceId, workspaceId));
    return rows.map((row) => this.toProviderProfile(row));
  }

  async update(input: ProviderProfileUpdateInput, userId: string): Promise<ProviderProfile> {
    const parsed = providerProfileUpdateSchema.parse(input);
    const existing = await this.getStored(parsed.id);
    if (!existing) {
      throw new NotFoundException("Provider profile not found");
    }
    await this.assertWorkspaceMember(existing.workspaceId, userId);
    const [profile] = await this.db
      .update(providerProfiles)
      .set({
        displayName: parsed.displayName,
        baseUrl: parsed.baseUrl,
        defaultModel: parsed.defaultModel,
        defaultImageModel: parsed.defaultImageModel,
        capabilities: parsed.capabilities,
        ...(parsed.apiKey ? { encryptedApiKey: this.encryptForStorage(parsed.apiKey) } : {}),
        updatedAt: new Date()
      })
      .where(eq(providerProfiles.id, parsed.id))
      .returning();
    if (!profile) {
      throw new Error("Provider profile update failed");
    }
    return this.toProviderProfile(profile);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const [profile] = await this.db.select().from(providerProfiles).where(eq(providerProfiles.id, id)).limit(1);
    if (!profile) {
      throw new NotFoundException("Provider profile not found");
    }
    await this.assertWorkspaceMember(profile.workspaceId, userId);
    await this.db.delete(providerProfiles).where(eq(providerProfiles.id, id));
    return true;
  }

  async getStored(id: string): Promise<StoredProviderProfile | undefined> {
    const [profile] = await this.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, id))
      .limit(1);
    return profile ? this.toStoredProviderProfile(profile) : undefined;
  }

  async getApiKey(id: string): Promise<string> {
    const profile = await this.getStored(id);
    if (!profile) {
      throw new BadRequestException("Provider profile not found");
    }
    return this.decryptFromStorage(profile.encryptedApiKey);
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    await this.workspaces.assertMember(workspaceId, userId);
  }

  private encryptForStorage(value: string): string {
    const key = createHash("sha256").update(this.providerSecretKey()).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  private decryptFromStorage(value: string): string {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) {
      throw new InternalServerErrorException("Invalid encrypted provider key payload");
    }
    const key = createHash("sha256").update(this.providerSecretKey()).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
  }

  private providerSecretKey(): string {
    const secret = process.env.PROVIDER_SECRET_KEY?.trim();
    if (secret) {
      return secret;
    }
    throw new InternalServerErrorException("PROVIDER_SECRET_KEY is required for persisted provider API keys");
  }

  private toProviderProfile(row: typeof providerProfiles.$inferSelect): ProviderProfile {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      displayName: row.displayName,
      providerType: ProviderTypeGql.OPENAI_COMPATIBLE,
      baseUrl: row.baseUrl,
      defaultModel: row.defaultModel,
      capabilities: row.capabilities,
      hasApiKey: true,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.defaultImageModel ? { defaultImageModel: row.defaultImageModel } : {}),
      ...(row.verifiedAt ? { verifiedAt: row.verifiedAt.toISOString() } : {})
    };
  }

  private toStoredProviderProfile(row: typeof providerProfiles.$inferSelect): StoredProviderProfile {
    return {
      ...this.toProviderProfile(row),
      encryptedApiKey: row.encryptedApiKey
    };
  }
}
