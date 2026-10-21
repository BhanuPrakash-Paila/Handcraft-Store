import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { HttpRequest } from "@azure/functions";
import { getCookie } from "./http.js";
import { getPool } from "./db.js";

const SESSION_COOKIE = "store_session";
const GUEST_CART_COOKIE = "store_cart";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function signedValue(request: HttpRequest, name: string): string | null {
  const value = getCookie(request, name);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  const valid =
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
  return valid ? payload : null;
}

export function sessionCookie(token: string): string {
  const payload = `${token}.${sign(token)}`;
  return `store_session=${encodeURIComponent(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function guestCartCookie(id: string): string {
  const payload = `${id}.${sign(id)}`;
  return `store_cart=${encodeURIComponent(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await getPool().query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '7 days')`,
    [userId, tokenHash],
  );
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  role: "customer" | "admin";
}

export async function getSession(request: HttpRequest): Promise<SessionUser | null> {
  const token = signedValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await getPool().query<SessionUser>(
    `SELECT u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL
      LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function revokeSession(request: HttpRequest): Promise<void> {
  const token = signedValue(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await getPool().query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export function cartId(request: HttpRequest): string | null {
  return signedValue(request, GUEST_CART_COOKIE);
}
