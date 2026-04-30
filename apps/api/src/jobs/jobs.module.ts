import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { DbModule } from "../db/db.module";
import { ProviderProfilesModule } from "../provider-profiles/provider-profiles.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { JobsResolver } from "./jobs.resolver";
import { JobsService } from "./jobs.service";

@Module({
  imports: [AiModule, DbModule, ProviderProfilesModule, WorkspacesModule],
  providers: [JobsService, JobsResolver]
})
export class JobsModule {}
