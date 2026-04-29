import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Skill, SkillUploadInput, SkillUploadResult } from "./skill.types";
import { SkillsService } from "./skills.service";

@Resolver(() => Skill)
export class SkillsResolver {
  constructor(private readonly skillService: SkillsService) {}

  @Query(() => [Skill])
  skills(@Args("workspaceId", { type: () => String }) workspaceId: string): Skill[] {
    return this.skillService.list(workspaceId);
  }

  @Mutation(() => SkillUploadResult)
  uploadSkill(@Args("input", { type: () => SkillUploadInput }) input: SkillUploadInput): SkillUploadResult {
    return this.skillService.upload(input);
  }
}
