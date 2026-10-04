import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, adminUsersTable, sessionsTable, usersTable } from "@workspace/db";

const COOKIE_NAME = "mandi_session";
const SESSION_DAYS = 7;

declare global {
  namespace Express {
    interface Request {
      currentUser?: typeof usersTable.$inferSelect;
    }
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOtp(): { code: string; codeHash: string } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for phone verification.");
  const code = randomInt(100000, 1000000).toString();
  return { code, codeHash: hash(`${secret}:${code}`) };
}

export function checkOtp(code: string, codeHash: string): boolean {
  const secret = process.env.SESSION_SECRET;
  return !!secret && hash(`${secret}:${code}`) === codeHash;
}

export function createToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenHash(token: string): string {
  return hash(token);
}

export function setSessionCookie(response: Response, token: string): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

export function clearSessionCookie(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function readSessionToken(request: Request): string | null {
  const rawCookie = request.headers.cookie;
  if (!rawCookie) return null;
  for (const pair of rawCookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === COOKIE_NAME) {
      const token = rest.join("=");
      return /^[a-f0-9]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}

export async function sessionUser(request: Request): Promise<typeof usersTable.$inferSelect | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const now = new Date();
  const [session] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(
      eq(sessionsTable.tokenHash, tokenHash(token)),
      gt(sessionsTable.expiresAt, now),
      eq(usersTable.enabled, true),
    ))
    .limit(1);
  return session?.user ?? null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const user = await sessionUser(request);
  if (!user) {
    response.status(401).json({ error: "Sign in to continue." });
    return;
  }
  request.currentUser = user;
  next();
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction): Promise<void> {
  const user = await sessionUser(request);
  if (!user || user.role !== "admin") {
    response.status(401).json({ error: "Admin access is required." });
    return;
  }
  const [admin] = await db.select().from(adminUsersTable).where(and(
    eq(adminUsersTable.userId, user.id),
    eq(adminUsersTable.enabled, true),
  )).limit(1);
  if (!admin) {
    response.status(401).json({ error: "Admin access is required." });
    return;
  }
  request.currentUser = user;
  next();
}

export function adminPhoneAllowed(phone: string): boolean {
  const approved = (process.env.ADMIN_PHONES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return approved.includes(phone);
}

export async function issueSession(userId: string, response: Response): Promise<void> {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({
    id: randomBytes(16).toString("hex"),
    tokenHash: tokenHash(token),
    userId,
    expiresAt,
  });
  setSessionCookie(response, token);
}

export async function revokeSession(request: Request, response: Response): Promise<void> {
  const token = readSessionToken(request);
  if (token) await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash(token)));
  clearSessionCookie(response);
}

export function generatedOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export const otpExpiration = () => new Date(Date.now() + 5 * 60 * 1000);