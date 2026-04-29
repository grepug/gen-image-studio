import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { isoNow } from "../common/date";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProviderProfile, ProviderProfileInput } from "./provider-profile.types";

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

type StoredProviderProfile = ProviderProfile & {
  encryptedApiKey: string;
};

@Injectable()
export class ProviderProfilesService {
  private readonly profiles = new Map<string, StoredProviderProfile>();

  constructor(private readonly workspaces: WorkspacesService) {}

  create(input: ProviderProfileInput, userId: string): ProviderProfile {
    this.assertWorkspaceMember(input.workspaceId, userId);
    providerProfileInputSchema.parse({
      ...input,
      providerType: "openai-compatible"
    });
    const now = isoNow();
    const profile: StoredProviderProfile = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      defaultModel: input.defaultModel,
      capabilities: input.capabilities,
      hasApiKey: true,
      encryptedApiKey: this.encryptForStorage(input.apiKey),
      createdAt: now,
      updatedAt: now,
      ...(input.defaultImageModel ? { defaultImageModel: input.defaultImageModel } : {})
    };
    this.profiles.set(profile.id, profile);
    return this.redact(profile);
  }

  list(workspaceId: string, userId: string): ProviderProfile[] {
    this.assertWorkspaceMember(workspaceId, userId);
    return [...this.profiles.values()]
      .filter((profile) => profile.workspaceId === workspaceId)
      .map((profile) => this.redact(profile));
  }

  getStored(id: string): StoredProviderProfile | undefined {
    return this.profiles.get(id);
  }

  getApiKey(id: string): string {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new BadRequestException("Provider profile not found");
    }
    return this.decryptFromStorage(profile.encryptedApiKey);
  }

  private redact(profile: StoredProviderProfile): ProviderProfile {
    const { encryptedApiKey: _encryptedApiKey, ...view } = profile;
    return view;
  }

  private assertWorkspaceMember(workspaceId: string, userId: string): void {
    if (!this.workspaces.isMember(workspaceId, userId)) {
      throw new ForbiddenException("User is not a member of this workspace");
    }
  }

  private encryptForStorage(value: string): string {
    const secret = process.env.PROVIDER_SECRET_KEY;
    if (!secret && process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("PROVIDER_SECRET_KEY is required in production");
    }
    const key = createHash("sha256").update(secret ?? "local-e2e-provider-secret").digest();
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
    const secret = process.env.PROVIDER_SECRET_KEY;
    if (!secret && process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("PROVIDER_SECRET_KEY is required in production");
    }
    const key = createHash("sha256").update(secret ?? "local-e2e-provider-secret").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
  }
}
