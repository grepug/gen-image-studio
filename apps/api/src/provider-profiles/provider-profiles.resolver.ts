import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { ProviderProfile, ProviderProfileInput } from "./provider-profile.types";
import { ProviderProfilesService } from "./provider-profiles.service";

const demoUserId = "00000000-0000-4000-8000-000000000001";

@Resolver(() => ProviderProfile)
export class ProviderProfilesResolver {
  constructor(private readonly providerProfileService: ProviderProfilesService) {}

  @Query(() => [ProviderProfile])
  providerProfiles(@Args("workspaceId", { type: () => String }) workspaceId: string): ProviderProfile[] {
    return this.providerProfileService.list(workspaceId, demoUserId);
  }

  @Mutation(() => ProviderProfile)
  createProviderProfile(@Args("input", { type: () => ProviderProfileInput }) input: ProviderProfileInput): ProviderProfile {
    return this.providerProfileService.create(input, demoUserId);
  }
}
