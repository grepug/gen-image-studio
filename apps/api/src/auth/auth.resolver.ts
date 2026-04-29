import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { AuthService } from "./auth.service";
import { CurrentUser, LoginResult, PasskeyChallenge } from "./auth.types";

@Resolver()
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Query(() => CurrentUser)
  currentUser(): CurrentUser {
    return this.auth.currentUser();
  }

  @Mutation(() => PasskeyChallenge)
  startPasskeyRegistration(): PasskeyChallenge {
    return this.auth.startPasskeyRegistration();
  }

  @Mutation(() => PasskeyChallenge)
  startPasskeyAuthentication(): PasskeyChallenge {
    return this.auth.startPasskeyAuthentication();
  }

  @Mutation(() => Boolean)
  finishPasskeyCeremony(@Args("challengeId", { type: () => String }) challengeId: string): boolean {
    return this.auth.finishPasskeyCeremony(challengeId);
  }

  @Mutation(() => LoginResult, { nullable: true })
  loginWithPassword(
    @Args("email", { type: () => String }) email: string,
    @Args("password", { type: () => String }) password: string
  ): LoginResult | null {
    return this.auth.loginWithPassword(email, password);
  }
}
