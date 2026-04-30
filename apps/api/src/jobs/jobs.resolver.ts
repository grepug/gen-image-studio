import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { RequestWithHeaders } from "../auth/session";
import { currentUserId } from "../workspaces/workspaces.resolver";
import { GenerationJob, RunImageGenerationJobInput } from "./job.types";
import { JobsService } from "./jobs.service";

@Resolver(() => GenerationJob)
export class JobsResolver {
  constructor(private readonly jobsService: JobsService) {}

  @Query(() => [GenerationJob])
  generationJobs(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: RequestWithHeaders
  ): Promise<GenerationJob[]> {
    return this.jobsService.list(workspaceId, currentUserId(req));
  }

  @Mutation(() => GenerationJob)
  runImageGenerationJob(
    @Args("input", { type: () => RunImageGenerationJobInput }) input: RunImageGenerationJobInput,
    @Context("req") req: RequestWithHeaders
  ): Promise<GenerationJob> {
    return this.jobsService.runImageGeneration(input, currentUserId(req));
  }
}
