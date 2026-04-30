import { Field, InputType, Int, ObjectType } from "@nestjs/graphql";

@InputType()
export class RunImageGenerationJobInput {
  @Field()
  workspaceId: string;

  @Field()
  providerProfileId: string;

  @Field()
  skillId: string;

  @Field()
  prompt: string;
}

@ObjectType()
export class JobEvent {
  @Field()
  id: string;

  @Field()
  type: string;

  @Field({ nullable: true })
  message?: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class JobOutput {
  @Field()
  id: string;

  @Field()
  assetId: string;

  @Field()
  label: string;

  @Field()
  mimeType: string;

  @Field(() => Int)
  byteSize: number;

  @Field()
  sha256: string;

  @Field()
  assetUrl: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class GenerationJob {
  @Field()
  id: string;

  @Field()
  workspaceId: string;

  @Field({ nullable: true })
  skillVersionId?: string;

  @Field({ nullable: true })
  providerProfileId?: string;

  @Field()
  status: string;

  @Field()
  prompt: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => [JobEvent])
  events: JobEvent[];

  @Field(() => [JobOutput])
  outputs: JobOutput[];
}
