import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { currentUserId } from "../workspaces/workspaces.resolver";
import { AuthService } from "./auth.service";
import { CurrentUser, LoginResult, PasskeyChallenge } from "./auth.types";

@Resolver()
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Query(() => CurrentUser)
  currentUser(@Context("req") req: { headers: Record<string, string | undefined> }): CurrentUser {
    const headerUserId = req.headers["x-user-id"];
    return this.auth.currentUser(headerUserId);
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
