import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class CurrentUser {
  @Field()
  id: string;

  @Field()
  displayName: string;
}

@ObjectType()
export class PasskeyChallenge {
  @Field()
  challengeId: string;

  @Field()
  challenge: string;

  @Field()
  rpId: string;

  @Field()
  origin: string;

  @Field()
  expiresAt: string;
}

