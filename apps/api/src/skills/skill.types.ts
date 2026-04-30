import { Field, InputType, ObjectType } from "@nestjs/graphql";

@InputType()
export class SkillUploadInput {
  @Field()
  workspaceId: string;

  @Field()
  archiveSha256: string;

  @Field()
  fileName: string;

  @Field()
  mimeType: string;

  @Field()
  byteSize: number;

  @Field()
  contentBase64: string;

  @Field(() => [String], { defaultValue: [] })
  permissions: string[];
}

@ObjectType()
export class SkillVersion {
  @Field()
  id: string;

  @Field()
  skillId: string;

  @Field()
  version: string;

  @Field()
  name: string;

  @Field()
  description: string;

  @Field(() => [String])
  permissions: string[];

  @Field()
  validationStatus: string;

  @Field(() => [String])
  validationErrors: string[];

  @Field()
  createdAt: string;
}

@ObjectType()
export class Skill {
  @Field()
  id: string;

  @Field()
  workspaceId: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  latestVersionId?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class SkillUploadResult {
  @Field(() => Skill)
  skill: Skill;

  @Field(() => SkillVersion)
  version: SkillVersion;
}
