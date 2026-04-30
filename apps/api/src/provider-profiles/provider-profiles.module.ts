import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProviderProfilesResolver } from "./provider-profiles.resolver";
import { ProviderProfilesService } from "./provider-profiles.service";

@Module({
  imports: [WorkspacesModule],
  providers: [ProviderProfilesService, ProviderProfilesResolver],
  exports: [ProviderProfilesService]
})
export class ProviderProfilesModule {}
