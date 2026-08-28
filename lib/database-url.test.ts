import { describe, expect, it } from "vitest";
import { pinPostgresSslMode } from "./database-url";

describe("PostgreSQL SSL configuration", () => {
  it.each(["prefer", "require", "verify-ca"])(
    "pins legacy strict mode %s to verify-full",
    (mode) => {
      expect(
        pinPostgresSslMode(
          `postgresql://user:pass@db.example/app?sslmode=${mode}`,
        ),
      ).toContain("sslmode=verify-full");
    },
  );

  it("keeps explicit local disable mode", () => {
    expect(
      pinPostgresSslMode(
        "postgresql://postgres:postgres@localhost:5432/test?sslmode=disable",
      ),
    ).toContain("sslmode=disable");
  });

  it("keeps the requested libpq compatibility behavior", () => {
    expect(
      pinPostgresSslMode(
        "postgresql://user:pass@db.example/app?uselibpqcompat=true&sslmode=require",
      ),
    ).toContain("sslmode=require");
  });
});
