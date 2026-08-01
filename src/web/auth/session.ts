export const PRODUCT_SESSION_VERSION = 1;
export const PRODUCT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const PRODUCT_LOCAL_SESSION_KEY = "standby.product-session.local";
export const PRODUCT_DEMO_SESSION_KEY = "standby.product-session.demo";

export type ProductSession =
  | { kind: "local"; name: string; email: string }
  | { kind: "demo" };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProductSessionStorageOptions {
  localStorage?: StorageLike | null;
  sessionStorage?: StorageLike | null;
  now?: () => number;
}

interface LocalSessionEnvelope {
  version: typeof PRODUCT_SESSION_VERSION;
  expiresAt: number;
  session: Extract<ProductSession, { kind: "local" }>;
}

interface DemoSessionEnvelope {
  version: typeof PRODUCT_SESSION_VERSION;
  session: Extract<ProductSession, { kind: "demo" }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseLocalSession(value: unknown): Extract<ProductSession, { kind: "local" }> | undefined {
  if (!isRecord(value) || value.kind !== "local") return undefined;
  if (!isNonEmptyString(value.name) || !isNonEmptyString(value.email)) {
    return undefined;
  }
  return { kind: "local", name: value.name.trim(), email: value.email.trim() };
}

function parseDemoSession(value: unknown): Extract<ProductSession, { kind: "demo" }> | undefined {
  if (!isRecord(value) || value.kind !== "demo") return undefined;
  return { kind: "demo" };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function windowStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window[name];
  } catch {
    return undefined;
  }
}

function resolveStorage(
  options: ProductSessionStorageOptions,
  name: "localStorage" | "sessionStorage",
): StorageLike | undefined {
  if (Object.prototype.hasOwnProperty.call(options, name)) {
    return options[name] ?? undefined;
  }
  return windowStorage(name);
}

function safeGet(storage: StorageLike | undefined, key: string): string | undefined {
  if (storage === undefined) return undefined;
  try {
    return storage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function safeSet(storage: StorageLike | undefined, key: string, value: string): void {
  if (storage === undefined) return;
  try {
    storage.setItem(key, value);
  } catch {
    // A private or quota-limited browser may reject storage. The in-memory UI
    // session can continue without persistence.
  }
}

function safeRemove(storage: StorageLike | undefined, key: string): void {
  if (storage === undefined) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort when the browser denies access.
  }
}

function readDemoSession(storage: StorageLike | undefined): ProductSession | undefined {
  const raw = safeGet(storage, PRODUCT_DEMO_SESSION_KEY);
  if (raw === undefined) return undefined;
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== PRODUCT_SESSION_VERSION) {
    safeRemove(storage, PRODUCT_DEMO_SESSION_KEY);
    return undefined;
  }
  const session = parseDemoSession(value.session);
  if (session === undefined) safeRemove(storage, PRODUCT_DEMO_SESSION_KEY);
  return session;
}

function readLocalSession(
  storage: StorageLike | undefined,
  now: number,
): ProductSession | undefined {
  const raw = safeGet(storage, PRODUCT_LOCAL_SESSION_KEY);
  if (raw === undefined) return undefined;
  const value = parseJson(raw);
  if (
    !isRecord(value)
    || value.version !== PRODUCT_SESSION_VERSION
    || typeof value.expiresAt !== "number"
    || !Number.isFinite(value.expiresAt)
    || value.expiresAt <= now
  ) {
    safeRemove(storage, PRODUCT_LOCAL_SESSION_KEY);
    return undefined;
  }
  const session = parseLocalSession(value.session);
  if (session === undefined) safeRemove(storage, PRODUCT_LOCAL_SESSION_KEY);
  return session;
}

/**
 * Reads the current browser-only product session synchronously.
 *
 * A tab-scoped demo selection takes precedence over a persisted local profile. This
 * module is an interface gate for the prototype, not server authentication.
 */
export function readProductSession(
  options: ProductSessionStorageOptions = {},
): ProductSession | undefined {
  const demo = readDemoSession(resolveStorage(options, "sessionStorage"));
  if (demo !== undefined) return demo;
  return readLocalSession(
    resolveStorage(options, "localStorage"),
    (options.now ?? Date.now)(),
  );
}

/**
 * Persists only the allow-listed profile fields. Credentials, OAuth tokens,
 * and passwords are deliberately not represented or serialized here.
 */
export function saveProductSession(
  session: ProductSession,
  options: ProductSessionStorageOptions = {},
): void {
  const local = resolveStorage(options, "localStorage");
  const tab = resolveStorage(options, "sessionStorage");

  if (session.kind === "demo") {
    const envelope: DemoSessionEnvelope = {
      version: PRODUCT_SESSION_VERSION,
      session: { kind: "demo" },
    };
    safeRemove(local, PRODUCT_LOCAL_SESSION_KEY);
    safeSet(tab, PRODUCT_DEMO_SESSION_KEY, JSON.stringify(envelope));
    return;
  }

  const parsed = parseLocalSession(session);
  if (parsed === undefined) {
    throw new TypeError("A local product session requires a valid name and email.");
  }
  const envelope: LocalSessionEnvelope = {
    version: PRODUCT_SESSION_VERSION,
    expiresAt: (options.now ?? Date.now)() + PRODUCT_SESSION_TTL_MS,
    session: parsed,
  };
  safeRemove(tab, PRODUCT_DEMO_SESSION_KEY);
  safeSet(local, PRODUCT_LOCAL_SESSION_KEY, JSON.stringify(envelope));
}

export function clearProductSession(
  options: ProductSessionStorageOptions = {},
): void {
  safeRemove(resolveStorage(options, "localStorage"), PRODUCT_LOCAL_SESSION_KEY);
  safeRemove(resolveStorage(options, "sessionStorage"), PRODUCT_DEMO_SESSION_KEY);
}
