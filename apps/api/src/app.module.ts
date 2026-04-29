import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GraphQLModule } from "@nestjs/graphql";
import { AiModule } from "./ai/ai.module";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./db/db.module";
import { ProviderProfilesModule } from "./provider-profiles/provider-profiles.module";
import { SkillsModule } from "./skills/skills.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: true
    }),
    DbModule,
    WorkspacesModule,
    AuthModule,
    ProviderProfilesModule,
    AiModule,
    SkillsModule
  ]
})
export class AppModule {}

