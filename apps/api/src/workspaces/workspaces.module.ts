import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { WorkspacesResolver } from "./workspaces.resolver";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [DbModule],
  providers: [WorkspacesService, WorkspacesResolver],
  exports: [WorkspacesService]
})
export class WorkspacesModule {}
