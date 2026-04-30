import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { RequestWithHeaders } from "../auth/session";
import { currentUserId } from "../workspaces/workspaces.resolver";
import { ProviderProfile, ProviderProfileInput, ProviderProfileUpdateInput } from "./provider-profile.types";
import { ProviderProfilesService } from "./provider-profiles.service";

@Resolver(() => ProviderProfile)
export class ProviderProfilesResolver {
  constructor(private readonly providerProfileService: ProviderProfilesService) {}

  @Query(() => [ProviderProfile])
  providerProfiles(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: RequestWithHeaders
  ): Promise<ProviderProfile[]> {
    return this.providerProfileService.list(workspaceId, currentUserId(req));
  }

  @Mutation(() => ProviderProfile)
  createProviderProfile(
    @Args("input", { type: () => ProviderProfileInput }) input: ProviderProfileInput,
    @Context("req") req: RequestWithHeaders
  ): Promise<ProviderProfile> {
    return this.providerProfileService.create(input, currentUserId(req));
  }

  @Mutation(() => ProviderProfile)
  updateProviderProfile(
    @Args("input", { type: () => ProviderProfileUpdateInput }) input: ProviderProfileUpdateInput,
    @Context("req") req: RequestWithHeaders
  ): Promise<ProviderProfile> {
    return this.providerProfileService.update(input, currentUserId(req));
  }

  @Mutation(() => Boolean)
  deleteProviderProfile(
    @Args("id", { type: () => String }) id: string,
    @Context("req") req: RequestWithHeaders
  ): Promise<boolean> {
    return this.providerProfileService.delete(id, currentUserId(req));
  }
}
