import { Field, InputType, ObjectType, registerEnumType } from "@nestjs/graphql";

export enum ProviderTypeGql {
  OPENAI_COMPATIBLE = "OPENAI_COMPATIBLE"
}

registerEnumType(ProviderTypeGql, { name: "ProviderType" });

@InputType()
export class ProviderProfileInput {
  @Field()
  workspaceId: string;

  @Field()
  displayName: string;

  @Field(() => ProviderTypeGql)
  providerType: ProviderTypeGql;

  @Field()
  baseUrl: string;

  @Field()
  defaultModel: string;

  @Field({ nullable: true })
  defaultImageModel?: string;

  @Field(() => [String])
  capabilities: string[];

  @Field()
  apiKey: string;
}

@InputType()
export class ProviderProfileUpdateInput {
  @Field()
  id: string;

  @Field()
  displayName: string;

  @Field()
  baseUrl: string;

  @Field()
  defaultModel: string;

  @Field({ nullable: true })
  defaultImageModel?: string;

  @Field(() => [String])
  capabilities: string[];

  @Field({ nullable: true })
  apiKey?: string;
}

@ObjectType()
export class ProviderProfile {
  @Field()
  id: string;

  @Field()
  workspaceId: string;

  @Field()
  displayName: string;

  @Field(() => ProviderTypeGql)
  providerType: ProviderTypeGql;

  @Field()
  baseUrl: string;

  @Field()
  defaultModel: string;

  @Field({ nullable: true })
  defaultImageModel?: string;

  @Field(() => [String])
  capabilities: string[];

  @Field()
  hasApiKey: boolean;

  @Field({ nullable: true })
  verifiedAt?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}
