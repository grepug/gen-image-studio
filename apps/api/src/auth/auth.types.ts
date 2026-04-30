import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class CurrentUser {
  @Field()
  id: string;

  @Field()
  displayName: string;
}

@ObjectType()
export class LoginResult {
  @Field()
  userId: string;

  @Field()
  displayName: string;

  @Field()
  email: string;
}

@ObjectType()
export class PasskeyOptions {
  @Field()
  challengeId: string;

  @Field()
  optionsJson: string;
}
