// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  clearProductSession,
  PRODUCT_DEMO_SESSION_KEY,
  PRODUCT_LOCAL_SESSION_KEY,
  PRODUCT_SESSION_TTL_MS,
  PRODUCT_SESSION_VERSION,
  readProductSession,
  saveProductSession,
  type ProductSession,
} from "./session.js";

class MemoryStorage {
  readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException("Storage disabled", "SecurityError");
  }

  override setItem(): void {
    throw new DOMException("Storage disabled", "SecurityError");
  }

  override removeItem(): void {
    throw new DOMException("Storage disabled", "SecurityError");
  }
}

const now = 1_700_000_000_000;

function stores() {
  return {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    now: () => now,
  };
}

function localEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    version: PRODUCT_SESSION_VERSION,
    expiresAt: now + 1_000,
    session: { kind: "local", name: "Evan", email: "evan@example.com" },
    ...overrides,
  };
}

describe("product session storage", () => {
  it("persists a normalized local profile for exactly seven days", () => {
    const options = stores();
    saveProductSession({
      kind: "local",
      name: "  Evan He  ",
      email: "  evan@example.com  ",
    }, options);

    expect(options.sessionStorage.getItem(PRODUCT_DEMO_SESSION_KEY)).toBeNull();
    expect(JSON.parse(options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)!)).toEqual({
      version: PRODUCT_SESSION_VERSION,
      expiresAt: now + PRODUCT_SESSION_TTL_MS,
      session: {
        kind: "local",
        name: "Evan He",
        email: "evan@example.com",
      },
    });
    expect(readProductSession(options)).toEqual({
      kind: "local",
      name: "Evan He",
      email: "evan@example.com",
    });
  });

  it("allow-lists profile fields rather than persisting credentials or arbitrary data", () => {
    const options = stores();
    const unsafeSession = {
      kind: "local",
      name: "Evan",
      email: "evan@example.com",
      token: "google-id-token",
      password: "never-store-me",
      accessToken: "calendar-access-token",
    } as unknown as ProductSession;

    saveProductSession(unsafeSession, options);

    const raw = options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)!;
    expect(raw).not.toContain("google-id-token");
    expect(raw).not.toContain("never-store-me");
    expect(raw).not.toContain("calendar-access-token");
    expect(readProductSession(options)).toEqual({
      kind: "local",
      name: "Evan",
      email: "evan@example.com",
    });
  });

  it("keeps demo access tab-scoped and replaces a persisted local profile", () => {
    const options = stores();
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, "old profile");

    saveProductSession({ kind: "demo" }, options);

    expect(options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)).toBeNull();
    expect(JSON.parse(options.sessionStorage.getItem(PRODUCT_DEMO_SESSION_KEY)!)).toEqual({
      version: PRODUCT_SESSION_VERSION,
      session: { kind: "demo" },
    });
    expect(readProductSession(options)).toEqual({ kind: "demo" });
  });

  it("removes a tab-scoped demo when a local profile is selected", () => {
    const options = stores();
    options.sessionStorage.setItem(PRODUCT_DEMO_SESSION_KEY, "old demo");

    saveProductSession({
      kind: "local",
      name: "Evan",
      email: "evan@example.com",
    }, options);

    expect(options.sessionStorage.getItem(PRODUCT_DEMO_SESSION_KEY)).toBeNull();
    expect(readProductSession(options)?.kind).toBe("local");
  });

  it("prefers an explicit tab demo when both valid records already exist", () => {
    const options = stores();
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, JSON.stringify(localEnvelope()));
    options.sessionStorage.setItem(PRODUCT_DEMO_SESSION_KEY, JSON.stringify({
      version: PRODUCT_SESSION_VERSION,
      session: { kind: "demo" },
    }));

    expect(readProductSession(options)).toEqual({ kind: "demo" });
  });

  it.each([
    ["invalid JSON", "{"],
    ["an old version", JSON.stringify({ version: 0, session: { kind: "demo" } })],
    ["the wrong session kind", JSON.stringify({ version: 1, session: { kind: "local" } })],
  ])("discards %s in tab storage and falls back to a valid local profile", (_label, demoValue) => {
    const options = stores();
    options.sessionStorage.setItem(PRODUCT_DEMO_SESSION_KEY, demoValue);
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, JSON.stringify(localEnvelope()));

    expect(readProductSession(options)?.kind).toBe("local");
    expect(options.sessionStorage.getItem(PRODUCT_DEMO_SESSION_KEY)).toBeNull();
  });

  it.each([
    ["invalid JSON", "{"],
    ["an old version", JSON.stringify(localEnvelope({ version: 0 }))],
    ["a missing expiry", JSON.stringify({
      version: PRODUCT_SESSION_VERSION,
      session: { kind: "local", name: "Evan", email: "evan@example.com" },
    })],
    ["a non-finite expiry", JSON.stringify(localEnvelope({ expiresAt: "later" }))],
    ["an expired profile", JSON.stringify(localEnvelope({ expiresAt: now }))],
    ["the wrong session kind", JSON.stringify(localEnvelope({ session: { kind: "demo" } }))],
    ["a missing name", JSON.stringify(localEnvelope({
      session: { kind: "local", name: "", email: "evan@example.com" },
    }))],
    ["a missing email", JSON.stringify(localEnvelope({
      session: { kind: "local", name: "Evan", email: "" },
    }))],
  ])("discards %s from persisted local storage", (_label, localValue) => {
    const options = stores();
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, localValue);

    expect(readProductSession(options)).toBeUndefined();
    expect(options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)).toBeNull();
  });

  it("reconstructs only allow-listed fields from a stored local record", () => {
    const options = stores();
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, JSON.stringify(localEnvelope({
      session: {
        kind: "local",
        name: "  Evan  ",
        email: "  evan@example.com  ",
        token: "do-not-return",
      },
    })));

    expect(readProductSession(options)).toEqual({
      kind: "local",
      name: "Evan",
      email: "evan@example.com",
    });
  });

  it("rejects invalid local profile input before it reaches storage", () => {
    const options = stores();
    const invalid = {
      kind: "local",
      name: "",
      email: "evan@example.com",
    } as ProductSession;

    expect(() => saveProductSession(invalid, options)).toThrow(TypeError);
    expect(options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)).toBeNull();
  });

  it("clears local and demo records together", () => {
    const options = stores();
    options.localStorage.setItem(PRODUCT_LOCAL_SESSION_KEY, "profile");
    options.sessionStorage.setItem(PRODUCT_DEMO_SESSION_KEY, "demo");

    clearProductSession(options);

    expect(options.localStorage.getItem(PRODUCT_LOCAL_SESSION_KEY)).toBeNull();
    expect(options.sessionStorage.getItem(PRODUCT_DEMO_SESSION_KEY)).toBeNull();
  });

  it("remains synchronous and non-throwing when browser storage is unavailable", () => {
    const unavailable = {
      localStorage: new ThrowingStorage(),
      sessionStorage: new ThrowingStorage(),
      now: () => now,
    };

    expect(readProductSession(unavailable)).toBeUndefined();
    expect(() => saveProductSession({ kind: "demo" }, unavailable)).not.toThrow();
    expect(() => clearProductSession(unavailable)).not.toThrow();
    expect(readProductSession({ localStorage: null, sessionStorage: null })).toBeUndefined();
  });
});
