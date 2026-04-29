import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import { isoNow } from "../common/date";
import { CurrentUser, PasskeyChallenge } from "./auth.types";

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, PasskeyChallenge>();

  constructor(private readonly config: ConfigService) {}

  currentUser(): CurrentUser {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Local Developer"
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

  private createChallenge(): PasskeyChallenge {
    const challenge: PasskeyChallenge = {
      challengeId: randomUUID(),
      challenge: randomBytes(32).toString("base64url"),
      rpId: this.config.get<string>("PASSKEY_RP_ID") ?? "localhost",
      origin: this.config.get<string>("PASSKEY_ORIGIN") ?? "http://localhost:5173",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
    this.challenges.set(challenge.challengeId, challenge);
    return { ...challenge, expiresAt: challenge.expiresAt || isoNow() };
  }
}

