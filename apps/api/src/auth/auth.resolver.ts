import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { AuthService } from "./auth.service";
import { CurrentUser, LoginResult, PasskeyOptions } from "./auth.types";
import {
  clearSessionCookie,
  getSessionUser,
  RequestWithHeaders,
  requireSessionUser,
  ResponseWithHeaders,
  setSessionCookie
} from "./session";

@Resolver()
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Query(() => CurrentUser, { nullable: true })
  currentUser(@Context("req") req: RequestWithHeaders): Promise<CurrentUser | null> {
    return this.auth.currentUser(getSessionUser(req)?.userId);
  }

  @Mutation(() => PasskeyOptions)
  startPasskeyRegistration(@Context("req") req: RequestWithHeaders): Promise<PasskeyOptions> {
    return this.auth.startPasskeyRegistration(requireSessionUser(req).userId);
  }

  @Mutation(() => PasskeyOptions)
  startPasskeyAuthentication(): Promise<PasskeyOptions> {
    return this.auth.startPasskeyAuthentication();
  }

  @Mutation(() => LoginResult)
  async finishPasskeyRegistration(
    @Args("challengeId", { type: () => String }) challengeId: string,
    @Args("responseJson", { type: () => String }) responseJson: string,
    @Context("res") res: ResponseWithHeaders
  ): Promise<LoginResult> {
    const result = await this.auth.finishPasskeyRegistration(challengeId, responseJson);
    setSessionCookie(res, result.userId);
    return result;
  }

  @Mutation(() => LoginResult)
  async finishPasskeyAuthentication(
    @Args("challengeId", { type: () => String }) challengeId: string,
    @Args("responseJson", { type: () => String }) responseJson: string,
    @Context("res") res: ResponseWithHeaders
  ): Promise<LoginResult> {
    const result = await this.auth.finishPasskeyAuthentication(challengeId, responseJson);
    setSessionCookie(res, result.userId);
    return result;
  }

  @Mutation(() => LoginResult, { nullable: true })
  async loginWithPassword(
    @Args("email", { type: () => String }) email: string,
    @Args("password", { type: () => String }) password: string,
    @Context("res") res: ResponseWithHeaders
  ): Promise<LoginResult | null> {
    const result = await this.auth.loginWithPassword(email, password);
    if (result) {
      setSessionCookie(res, result.userId);
    }
    return result;
  }

  @Mutation(() => Boolean)
  logout(@Context("res") res: ResponseWithHeaders): boolean {
    clearSessionCookie(res);
    return true;
  }
}
