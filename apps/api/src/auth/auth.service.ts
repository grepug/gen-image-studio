import { Injectable } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { isoNow } from "../common/date";
import { CurrentUser, LoginResult, PasskeyChallenge } from "./auth.types";

interface TestAccount {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, PasskeyChallenge>();
  private readonly testAccounts: TestAccount[];

  constructor() {
    this.testAccounts = this.loadTestAccounts();
  }

  currentUser(userId?: string): CurrentUser {
    const account = this.testAccounts.find((candidate) => candidate.id === userId) ?? this.testAccounts[0];
    return {
      id: account?.id ?? "00000000-0000-4000-8000-000000000001",
      displayName: account?.displayName ?? "Local Developer"
    };
  }

  startPasskeyRegistration(): PasskeyChallenge {
    return this.createChallenge();
  }

  startPasskeyAuthentication(): PasskeyChallenge {
    return this.createChallenge();
  }

  finishPasskeyCeremony(challengeId: string): boolean {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      return false;
    }
    this.challenges.delete(challengeId);
    return true;
  }

  loginWithPassword(email: string, password: string): LoginResult | null {
    if (process.env.ENABLE_E2E_PASSWORD_LOGIN !== "true") {
      return null;
    }
    const account = this.testAccounts.find((candidate) => candidate.email === email && candidate.password === password);
    if (!account) {
      return null;
    }
    return {
      userId: account.id,
      displayName: account.displayName,
      email: account.email
    };
  }

  private createChallenge(): PasskeyChallenge {
    const challenge: PasskeyChallenge = {
      challengeId: randomUUID(),
      challenge: randomBytes(32).toString("base64url"),
      rpId: process.env.PASSKEY_RP_ID ?? "localhost",
      origin: process.env.PASSKEY_ORIGIN ?? "http://localhost:5173",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
    this.challenges.set(challenge.challengeId, challenge);
    return { ...challenge, expiresAt: challenge.expiresAt || isoNow() };
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
