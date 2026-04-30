import { UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "gis_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionUser {
  userId: string;
}

export interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

export interface ResponseWithHeaders {
  setHeader(name: string, value: string | string[]): void;
  getHeader(name: string): number | string | string[] | undefined;
}

interface SessionPayload {
  userId: string;
  exp: number;
}

export function getSessionUser(req: RequestWithHeaders): SessionUser | undefined {
  const rawCookie = headerValue(req.headers.cookie);
  const token = parseCookies(rawCookie)[COOKIE_NAME];
  if (!token) {
    return undefined;
  }
  const [payloadRaw, signature] = token.split(".");
  if (!payloadRaw || !signature) {
    return undefined;
  }
  const expected = sign(payloadRaw);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }
  const payload = JSON.parse(Buffer.from(payloadRaw, "base64url").toString("utf8")) as SessionPayload;
  if (!payload.userId || payload.exp <= Math.floor(Date.now() / 1000)) {
    return undefined;
  }
  return { userId: payload.userId };
}

export function requireSessionUser(req: RequestWithHeaders): SessionUser {
  const user = getSessionUser(req);
  if (!user) {
    throw new UnauthorizedException("Missing authenticated user");
  }
  return user;
}

export function setSessionCookie(res: ResponseWithHeaders, userId: string): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ userId, exp } satisfies SessionPayload)).toString("base64url");
  appendSetCookie(res, `${COOKIE_NAME}=${payload}.${sign(payload)}; ${cookieAttributes(SESSION_TTL_SECONDS)}`);
}

export function clearSessionCookie(res: ResponseWithHeaders): void {
  appendSetCookie(res, `${COOKIE_NAME}=; ${cookieAttributes(0)}`);
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is required for authenticated sessions");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(rawCookie: string | undefined): Record<string, string> {
  if (!rawCookie) {
    return {};
  }
  return Object.fromEntries(
    rawCookie
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((parts): parts is [string, string] => Boolean(parts[0] && parts[1]))
  );
}

function appendSetCookie(res: ResponseWithHeaders, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [String(existing), cookie]);
}

function cookieAttributes(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" || process.env.SESSION_COOKIE_SECURE === "true";
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join("; ") : value;
}
