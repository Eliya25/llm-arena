import { createHash, randomBytes } from "node:crypto";

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
