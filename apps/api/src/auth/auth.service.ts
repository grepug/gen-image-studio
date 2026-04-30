import { BadRequestException, Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential
} from "@simplewebauthn/server";
import { and, eq, isNull } from "drizzle-orm";
import { DB } from "../db/db.module";
import { passkeyCredentials, users, webauthnChallenges } from "../db/schema";
import { AppDb } from "../db/types";
import { CurrentUser, LoginResult, PasskeyOptions } from "./auth.types";

interface TestAccount {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

@Injectable()
export class AuthService {
  private readonly testAccounts: TestAccount[];

  constructor(@Inject(DB) private readonly db: AppDb) {
    this.testAccounts = this.loadTestAccounts();
  }

  async currentUser(userId?: string): Promise<CurrentUser | null> {
    if (!userId) {
      return null;
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      displayName: user.displayName
    };
  }

  async startPasskeyRegistration(userId: string): Promise<PasskeyOptions> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new BadRequestException("Authenticated user not found");
    }
    const credentials = await this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, userId));
    const options = await generateRegistrationOptions({
      rpName: process.env.PASSKEY_RP_NAME ?? "Gen Image Studio",
      rpID: this.rpId(),
      userName: user.email ?? user.id,
      userID: Buffer.from(user.id),
      userDisplayName: user.displayName,
      attestationType: "none",
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[]
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
      }
    });
    const [challenge] = await this.db
      .insert(webauthnChallenges)
      .values({
        userId,
        challenge: options.challenge,
        purpose: "registration",
        expiresAt: this.challengeExpiry()
      })
      .returning();
    if (!challenge) {
      throw new Error("Passkey registration challenge creation failed");
    }
    return { challengeId: challenge.id, optionsJson: JSON.stringify(options) };
  }

  async finishPasskeyRegistration(challengeId: string, responseJson: string): Promise<LoginResult> {
    const challenge = await this.consumeChallenge(challengeId, "registration");
    if (!challenge.userId) {
      throw new BadRequestException("Registration challenge is not bound to a user");
    }
    const response = JSON.parse(responseJson) as RegistrationResponseJSON;
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpId(),
      requireUserVerification: false
    });
    if (!verification.verified) {
      throw new BadRequestException("Passkey registration verification failed");
    }
    const { credential, credentialBackedUp } = verification.registrationInfo;
    await this.db
      .insert(passkeyCredentials)
      .values({
        userId: challenge.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: response.response.transports ?? [],
        backedUp: credentialBackedUp
      })
      .onConflictDoNothing();
    return this.loginResultForUser(challenge.userId);
  }

  async startPasskeyAuthentication(): Promise<PasskeyOptions> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(),
      userVerification: "preferred"
    });
    const [challenge] = await this.db
      .insert(webauthnChallenges)
      .values({
        challenge: options.challenge,
        purpose: "authentication",
        expiresAt: this.challengeExpiry()
      })
      .returning();
    if (!challenge) {
      throw new Error("Passkey authentication challenge creation failed");
    }
    return { challengeId: challenge.id, optionsJson: JSON.stringify(options) };
  }

  async finishPasskeyAuthentication(challengeId: string, responseJson: string): Promise<LoginResult> {
    const challenge = await this.consumeChallenge(challengeId, "authentication");
    const response = JSON.parse(responseJson) as AuthenticationResponseJSON;
    const [storedCredential] = await this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, response.id))
      .limit(1);
    if (!storedCredential) {
      throw new BadRequestException("Passkey credential not found");
    }
    const credential: WebAuthnCredential = {
      id: storedCredential.credentialId,
      publicKey: Buffer.from(storedCredential.publicKey, "base64url"),
      counter: storedCredential.counter,
      transports: storedCredential.transports as AuthenticatorTransportFuture[]
    };
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpId(),
      credential,
      requireUserVerification: false
    });
    if (!verification.verified) {
      throw new BadRequestException("Passkey authentication verification failed");
    }
    await this.db
      .update(passkeyCredentials)
      .set({ counter: verification.authenticationInfo.newCounter, updatedAt: new Date() })
      .where(eq(passkeyCredentials.id, storedCredential.id));
    return this.loginResultForUser(storedCredential.userId);
  }

  async loginWithPassword(email: string, password: string): Promise<LoginResult | null> {
    if (process.env.ENABLE_E2E_PASSWORD_LOGIN !== "true") {
      return null;
    }
    const account = this.testAccounts.find((candidate) => candidate.email === email && candidate.password === password);
    if (!account) {
      return null;
    }
    await this.ensureUser(account);
    return {
      userId: account.id,
      displayName: account.displayName,
      email: account.email
    };
  }

  private async consumeChallenge(challengeId: string, purpose: "authentication" | "registration") {
    const [challenge] = await this.db
      .select()
      .from(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.id, challengeId),
          eq(webauthnChallenges.purpose, purpose),
          isNull(webauthnChallenges.consumedAt)
        )
      )
      .limit(1);
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Passkey challenge is missing or expired");
    }
    await this.db
      .update(webauthnChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(webauthnChallenges.id, challenge.id));
    return challenge;
  }

  private async loginResultForUser(userId: string): Promise<LoginResult> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new BadRequestException("User not found");
    }
    return {
      userId: user.id,
      displayName: user.displayName,
      email: user.email ?? ""
    };
  }

  private async ensureUser(account: TestAccount): Promise<void> {
    await this.db
      .insert(users)
      .values({ id: account.id, displayName: account.displayName, email: account.email })
      .onConflictDoUpdate({
        target: users.id,
        set: { displayName: account.displayName, email: account.email, updatedAt: new Date() }
      });
  }

  private challengeExpiry(): Date {
    return new Date(Date.now() + 5 * 60 * 1000);
  }

  private rpId(): string {
    return process.env.PASSKEY_RP_ID ?? "localhost";
  }

  private origin(): string {
    return process.env.PASSKEY_ORIGIN ?? "http://localhost:5173";
  }

  private loadTestAccounts(): TestAccount[] {
    if (process.env.ENABLE_E2E_PASSWORD_LOGIN !== "true") {
      return [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "local@example.test",
          password: "",
          displayName: "Local Developer"
        }
      ];
    }
    const raw = process.env.E2E_TEST_ACCOUNTS_JSON;
    if (raw) {
      return JSON.parse(raw) as TestAccount[];
    }

    return Array.from({ length: 5 }, (_, index) => {
      const number = index + 1;
      return {
        id: `00000000-0000-4000-8000-00000000000${number}`,
        email: `tester${number}@example.test`,
        password: `test-password-${number}`,
        displayName: `Tester ${number}`
      };
    });
  }
}
