import { Injectable } from "@nestjs/common";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isoNow } from "../common/date";
import { ProviderProfile, ProviderProfileInput } from "./provider-profile.types";

type StoredProviderProfile = ProviderProfile & {
  encryptedApiKey: string;
};

@Injectable()
export class ProviderProfilesService {
  private readonly profiles = new Map<string, StoredProviderProfile>();

  create(input: ProviderProfileInput): ProviderProfile {
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

  list(workspaceId: string): ProviderProfile[] {
    return [...this.profiles.values()]
      .filter((profile) => profile.workspaceId === workspaceId)
      .map((profile) => this.redact(profile));
  }

  getStored(id: string): StoredProviderProfile | undefined {
    return this.profiles.get(id);
  }

  private redact(profile: StoredProviderProfile): ProviderProfile {
    const { encryptedApiKey: _encryptedApiKey, ...view } = profile;
    return view;
  }

  private encryptForStorage(value: string): string {
    const key = createHash("sha256").update(process.env.PROVIDER_SECRET_KEY ?? "local-dev-provider-secret").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }
}
