import { Module } from "@nestjs/common";
import { ProviderProfilesModule } from "../provider-profiles/provider-profiles.module";
import { AiProviderFactory } from "./ai-provider.factory";
import { ResponsesImageClient } from "./responses-image.client";

@Module({
  imports: [ProviderProfilesModule],
  providers: [AiProviderFactory, ResponsesImageClient],
  exports: [AiProviderFactory, ResponsesImageClient]
})
export class AiModule {}
