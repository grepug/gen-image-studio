import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { currentUserId } from "../workspaces/workspaces.resolver";
import { Skill, SkillUploadInput, SkillUploadResult } from "./skill.types";
import { SkillsService } from "./skills.service";

@Resolver(() => Skill)
export class SkillsResolver {
  constructor(private readonly skillService: SkillsService) {}

  @Query(() => [Skill])
  skills(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): Promise<Skill[]> {
    return this.skillService.list(workspaceId, currentUserId(req));
  }

  @Mutation(() => SkillUploadResult)
  uploadSkill(
    @Args("input", { type: () => SkillUploadInput }) input: SkillUploadInput,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): Promise<SkillUploadResult> {
    return this.skillService.upload(input, currentUserId(req));
  }
}
