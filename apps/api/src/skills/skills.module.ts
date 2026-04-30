import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SkillsResolver } from "./skills.resolver";
import { SkillsService } from "./skills.service";

@Module({
  imports: [DbModule, WorkspacesModule],
  providers: [SkillsService, SkillsResolver]
})
export class SkillsModule {}
