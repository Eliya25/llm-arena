import { pinPostgresSslMode } from "./database-url";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const optional = (name: string): string | undefined =>
  process.env[name] || undefined;

export const env = {
  OPENROUTER_API_KEY: required("OPENROUTER_API_KEY"),
  DATABASE_URL: pinPostgresSslMode(required("DATABASE_URL")),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: required(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ),
  CLERK_SECRET_KEY: required("CLERK_SECRET_KEY"),
  ARCJET_KEY: required("ARCJET_KEY"),
  NEXT_PUBLIC_POSTHOG_KEY: required("NEXT_PUBLIC_POSTHOG_KEY"),
  NEXT_PUBLIC_POSTHOG_HOST: required("NEXT_PUBLIC_POSTHOG_HOST"),
  HEALTHCHECK_SECRET: required("HEALTHCHECK_SECRET"),
  OPENROUTER_CHAT_URL:
    optional("OPENROUTER_CHAT_URL") ??
    "https://openrouter.ai/api/v1/chat/completions",
  LOAD_TEST_MODE:
    optional("LOAD_TEST_MODE") === "true" &&
    process.env.VERCEL_ENV !== "production",
  LOAD_TEST_SECRET: optional("LOAD_TEST_SECRET"),
} as const;
