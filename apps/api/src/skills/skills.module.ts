import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SkillsResolver } from "./skills.resolver";
import { SkillsService } from "./skills.service";

@Module({
  imports: [WorkspacesModule],
  providers: [SkillsService, SkillsResolver]
})
export class SkillsModule {}
