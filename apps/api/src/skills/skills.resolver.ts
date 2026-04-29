import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Skill, SkillUploadInput, SkillUploadResult } from "./skill.types";
import { SkillsService } from "./skills.service";

const demoUserId = "00000000-0000-4000-8000-000000000001";

@Resolver(() => Skill)
export class SkillsResolver {
  constructor(private readonly skillService: SkillsService) {}

  @Query(() => [Skill])
  skills(@Args("workspaceId", { type: () => String }) workspaceId: string): Skill[] {
    return this.skillService.list(workspaceId, demoUserId);
  }

  @Mutation(() => SkillUploadResult)
  uploadSkill(@Args("input", { type: () => SkillUploadInput }) input: SkillUploadInput): SkillUploadResult {
    return this.skillService.upload(input, demoUserId);
  }
}
