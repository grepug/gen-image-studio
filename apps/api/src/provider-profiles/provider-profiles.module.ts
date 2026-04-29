import { Module } from "@nestjs/common";
import { ProviderProfilesResolver } from "./provider-profiles.resolver";
import { ProviderProfilesService } from "./provider-profiles.service";

@Module({
  providers: [ProviderProfilesService, ProviderProfilesResolver],
  exports: [ProviderProfilesService]
})
export class ProviderProfilesModule {}

