const MODES_WITH_LEGACY_STRICT_BEHAVIOR = new Set([
  "prefer",
  "require",
  "verify-ca",
]);

export function pinPostgresSslMode(value: string): string {
  try {
    const url = new URL(value);
    const mode = url.searchParams.get("sslmode");
    if (
      mode &&
      MODES_WITH_LEGACY_STRICT_BEHAVIOR.has(mode) &&
      url.searchParams.get("uselibpqcompat") !== "true"
    ) {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return value;
  }
}
