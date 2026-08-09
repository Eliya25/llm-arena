function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  OPENROUTER_API_KEY: required("OPENROUTER_API_KEY"),
  DATABASE_URL: required("DATABASE_URL"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: required(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ),
  CLERK_SECRET_KEY: required("CLERK_SECRET_KEY"),
  ARCJET_KEY: required("ARCJET_KEY"),
  NEXT_PUBLIC_POSTHOG_KEY: required("NEXT_PUBLIC_POSTHOG_KEY"),
  NEXT_PUBLIC_POSTHOG_HOST: required("NEXT_PUBLIC_POSTHOG_HOST"),
} as const;
