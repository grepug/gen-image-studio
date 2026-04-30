import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [DbModule, WorkspacesModule],
  controllers: [AssetsController],
  providers: [AssetsService]
})
export class AssetsModule {}
