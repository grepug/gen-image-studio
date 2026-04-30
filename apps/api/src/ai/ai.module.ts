import { Module } from "@nestjs/common";
import { ProviderProfilesModule } from "../provider-profiles/provider-profiles.module";
import { AiProviderFactory } from "./ai-provider.factory";

@Module({
  imports: [ProviderProfilesModule],
  providers: [AiProviderFactory],
  exports: [AiProviderFactory]
})
export class AiModule {}

