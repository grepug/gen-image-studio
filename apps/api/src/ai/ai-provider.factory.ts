import { Injectable, NotFoundException } from "@nestjs/common";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModelV1 } from "ai";
import { ProviderProfilesService } from "../provider-profiles/provider-profiles.service";

@Injectable()
export class AiProviderFactory {
  constructor(private readonly providerProfiles: ProviderProfilesService) {}

  async createLanguageModel(profileId: string): Promise<LanguageModelV1> {
    const profile = await this.providerProfiles.getStored(profileId);
    if (!profile) {
      throw new NotFoundException("Provider profile not found");
    }
    const provider = createOpenAI({
      baseURL: profile.baseUrl,
      apiKey: await this.providerProfiles.getApiKey(profileId)
    });
    return provider(profile.defaultModel);
  }
}
