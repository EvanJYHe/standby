const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_SCRIPT_ID = "standby-google-identity-services";
const GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS = 15_000;
const GOOGLE_CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export interface GoogleCalendarConnectionToken {
  accessToken: string;
  expiresAt: number;
}

export interface GoogleCalendarVerification {
  calendarCount: number;
  primaryCalendarName?: string;
}

export interface GoogleCalendarIntegration {
  prepare(clientId: string): Promise<void>;
  connect(): Promise<GoogleCalendarConnectionToken>;
  verify(accessToken: string): Promise<GoogleCalendarVerification>;
  disconnect(accessToken: string): Promise<void>;
}

export type GoogleCalendarIntegrationErrorCode =
  | "UNAVAILABLE"
  | "INVALID_CLIENT_ID"
  | "SCRIPT_LOAD_FAILED"
  | "INITIALIZATION_FAILED"
  | "NOT_READY"
  | "BUSY"
  | "POPUP_CLOSED"
  | "POPUP_BLOCKED"
  | "POPUP_FAILED"
  | "CONSENT_DENIED"
  | "MISSING_SCOPES"
  | "INVALID_TOKEN_RESPONSE"
  | "INVALID_ACCESS_TOKEN"
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "REVOCATION_FAILED";

export class GoogleCalendarIntegrationError extends Error {
  readonly code: GoogleCalendarIntegrationErrorCode;
  readonly status: number | undefined;

  constructor(
    code: GoogleCalendarIntegrationErrorCode,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GoogleCalendarIntegrationError";
    this.code = code;
    this.status = options.status;
  }
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GooglePopupError {
  type?: string;
  message?: string;
}

interface GoogleRevokeResponse {
  successful?: boolean;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2Api {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: GoogleTokenResponse) => void;
    error_callback: (error: GooglePopupError) => void;
  }): GoogleTokenClient;
  hasGrantedAllScopes?(
    response: GoogleTokenResponse,
    ...scopes: string[]
  ): boolean;
  revoke(
    accessToken: string,
    callback: (response?: GoogleRevokeResponse) => void,
  ): void;
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: GoogleOAuth2Api;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

interface PendingConnection {
  promise: Promise<GoogleCalendarConnectionToken>;
  resolve: (connection: GoogleCalendarConnectionToken) => void;
  reject: (error: GoogleCalendarIntegrationError) => void;
}

interface GoogleCalendarListEntry {
  primary?: boolean;
  summary?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

function oauth2Api(): GoogleOAuth2Api | undefined {
  return window.google?.accounts.oauth2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function apiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  const nestedError = payload.error;
  if (isRecord(nestedError) && typeof nestedError.message === "string") {
    return nestedError.message;
  }

  return typeof payload.error_description === "string"
    ? payload.error_description
    : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new GoogleCalendarIntegrationError(
      "API_ERROR",
      "Google Calendar returned an unreadable response.",
      { cause: error, status: response.status },
    );
  }
}

function parseCalendarList(payload: unknown): GoogleCalendarListResponse {
  if (!isRecord(payload)) {
    throw new GoogleCalendarIntegrationError(
      "API_ERROR",
      "Google Calendar returned an unexpected response.",
    );
  }

  const result: GoogleCalendarListResponse = {};
  if (payload.items !== undefined) {
    if (!Array.isArray(payload.items)) {
      throw new GoogleCalendarIntegrationError(
        "API_ERROR",
        "Google Calendar returned an unexpected calendar list.",
      );
    }

    result.items = payload.items.filter(isRecord).map((item) => {
      const entry: GoogleCalendarListEntry = {};
      if (typeof item.primary === "boolean") {
        entry.primary = item.primary;
      }
      if (typeof item.summary === "string") {
        entry.summary = item.summary;
      }
      return entry;
    });
  }

  if (typeof payload.nextPageToken === "string") {
    result.nextPageToken = payload.nextPageToken;
  }

  return result;
}

/**
 * A browser-only Google Calendar authorization client.
 *
 * It intentionally never stores access tokens. The caller owns the short-lived
 * token returned by `connect` and should keep it in memory only.
 */
export class GoogleCalendarBrowserIntegration
  implements GoogleCalendarIntegration
{
  private scriptPromise: Promise<GoogleOAuth2Api> | undefined;
  private preparation:
    | { clientId: string; promise: Promise<void> }
    | undefined;
  private preparedClientId: string | undefined;
  private tokenClient: GoogleTokenClient | undefined;
  private pendingConnection: PendingConnection | undefined;
  private readonly pendingRevocations = new Map<string, Promise<void>>();

  prepare(clientId: string): Promise<void> {
    const normalizedClientId = clientId.trim();
    if (normalizedClientId.length === 0) {
      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "INVALID_CLIENT_ID",
          "A Google OAuth client ID is required.",
        ),
      );
    }

    if (
      this.preparedClientId === normalizedClientId &&
      this.tokenClient !== undefined
    ) {
      return Promise.resolve();
    }

    if (this.preparation !== undefined) {
      if (this.preparation.clientId === normalizedClientId) {
        return this.preparation.promise;
      }

      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "BUSY",
          "Google Calendar sign-in is already being prepared.",
        ),
      );
    }

    if (this.pendingConnection !== undefined) {
      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "BUSY",
          "Finish the current Google Calendar sign-in before changing clients.",
        ),
      );
    }

    const promise = this.initialize(normalizedClientId).finally(() => {
      if (this.preparation?.promise === promise) {
        this.preparation = undefined;
      }
    });
    this.preparation = { clientId: normalizedClientId, promise };
    return promise;
  }

  connect(): Promise<GoogleCalendarConnectionToken> {
    if (this.pendingConnection !== undefined) {
      return this.pendingConnection.promise;
    }

    if (this.tokenClient === undefined) {
      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "NOT_READY",
          "Google Calendar sign-in is still loading. Try again in a moment.",
        ),
      );
    }

    let resolveConnection!: (connection: GoogleCalendarConnectionToken) => void;
    let rejectConnection!: (error: GoogleCalendarIntegrationError) => void;
    const promise = new Promise<GoogleCalendarConnectionToken>((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    this.pendingConnection = {
      promise,
      resolve: resolveConnection,
      reject: rejectConnection,
    };

    try {
      // GIS opens its account/consent dialog from this user-initiated call.
      // Its default account chooser avoids forcing repeat consent after a reconnect.
      this.tokenClient.requestAccessToken();
    } catch (error) {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "POPUP_FAILED",
          "Google sign-in could not be opened. Check your popup settings and try again.",
          { cause: error },
        ),
      );
    }

    return promise;
  }

  async verify(accessToken: string): Promise<GoogleCalendarVerification> {
    const normalizedAccessToken = accessToken.trim();
    if (normalizedAccessToken.length === 0) {
      throw new GoogleCalendarIntegrationError(
        "INVALID_ACCESS_TOKEN",
        "A Google Calendar access token is required.",
      );
    }

    let calendarCount = 0;
    let primaryCalendarName: string | undefined;
    let pageToken: string | undefined;
    const seenPageTokens = new Set<string>();

    do {
      const url = new URL(GOOGLE_CALENDAR_LIST_ENDPOINT);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("minAccessRole", "writer");
      if (pageToken !== undefined) {
        url.searchParams.set("pageToken", pageToken);
      }

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${normalizedAccessToken}`,
          },
        });
      } catch (error) {
        throw new GoogleCalendarIntegrationError(
          "NETWORK_ERROR",
          "Google Calendar could not be reached. Check your connection and try again.",
          { cause: error },
        );
      }

      const payload = await readJson(response);
      if (!response.ok) {
        const detail = apiErrorMessage(payload);
        if (response.status === 401) {
          throw new GoogleCalendarIntegrationError(
            "AUTH_EXPIRED",
            "Google Calendar access expired. Connect again to continue.",
            { status: response.status },
          );
        }
        if (response.status === 403) {
          throw new GoogleCalendarIntegrationError(
            "PERMISSION_DENIED",
            detail ??
              "Google Calendar access was denied. Reconnect and grant calendar access.",
            { status: response.status },
          );
        }

        throw new GoogleCalendarIntegrationError(
          "API_ERROR",
          detail ?? `Google Calendar returned an error (${response.status}).`,
          { status: response.status },
        );
      }

      const page = parseCalendarList(payload);
      const items = page.items ?? [];
      calendarCount += items.length;
      primaryCalendarName ??= items.find((item) => item.primary)?.summary;

      pageToken = page.nextPageToken;
      if (pageToken !== undefined) {
        if (seenPageTokens.has(pageToken)) {
          throw new GoogleCalendarIntegrationError(
            "API_ERROR",
            "Google Calendar returned an invalid pagination response.",
          );
        }
        seenPageTokens.add(pageToken);
      }
    } while (pageToken !== undefined);

    return primaryCalendarName === undefined
      ? { calendarCount }
      : { calendarCount, primaryCalendarName };
  }

  disconnect(accessToken: string): Promise<void> {
    const normalizedAccessToken = accessToken.trim();
    if (normalizedAccessToken.length === 0) {
      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "INVALID_ACCESS_TOKEN",
          "A Google Calendar access token is required.",
        ),
      );
    }

    const existing = this.pendingRevocations.get(normalizedAccessToken);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.revoke(normalizedAccessToken).finally(() => {
      if (this.pendingRevocations.get(normalizedAccessToken) === promise) {
        this.pendingRevocations.delete(normalizedAccessToken);
      }
    });
    this.pendingRevocations.set(normalizedAccessToken, promise);
    return promise;
  }

  private async initialize(clientId: string): Promise<void> {
    const oauth2 = await this.loadGoogleIdentityServices();

    let tokenClient: GoogleTokenClient;
    try {
      tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPES.join(" "),
        include_granted_scopes: true,
        callback: (response) => {
          this.handleTokenResponse(response);
        },
        error_callback: (error) => {
          this.handlePopupError(error);
        },
      });
    } catch (error) {
      throw new GoogleCalendarIntegrationError(
        "INITIALIZATION_FAILED",
        "Google Calendar sign-in could not be initialized.",
        { cause: error },
      );
    }

    if (typeof tokenClient.requestAccessToken !== "function") {
      throw new GoogleCalendarIntegrationError(
        "INITIALIZATION_FAILED",
        "Google Calendar sign-in loaded incorrectly. Refresh and try again.",
      );
    }

    this.tokenClient = tokenClient;
    this.preparedClientId = clientId;
  }

  private loadGoogleIdentityServices(): Promise<GoogleOAuth2Api> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return Promise.reject(
        new GoogleCalendarIntegrationError(
          "UNAVAILABLE",
          "Google Calendar sign-in is only available in a browser.",
        ),
      );
    }

    const availableApi = oauth2Api();
    if (availableApi !== undefined) {
      return Promise.resolve(availableApi);
    }

    if (this.scriptPromise !== undefined) {
      return this.scriptPromise;
    }

    const promise = new Promise<GoogleOAuth2Api>((resolve, reject) => {
      const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
      const script =
        existing instanceof HTMLScriptElement
          ? existing
          : document.createElement("script");
      const created = script !== existing;

      let timeoutId: number | undefined;
      const cleanup = () => {
        script.removeEventListener("load", handleLoad);
        script.removeEventListener("error", handleError);
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      };
      const fail = (message: string, cause?: unknown) => {
        cleanup();
        if (script.id === GOOGLE_IDENTITY_SCRIPT_ID) {
          script.remove();
        }
        reject(
          new GoogleCalendarIntegrationError(
            "SCRIPT_LOAD_FAILED",
            message,
            cause === undefined ? {} : { cause },
          ),
        );
      };
      const handleLoad = () => {
        const api = oauth2Api();
        if (api === undefined) {
          fail("Google sign-in loaded incorrectly. Refresh and try again.");
          return;
        }

        cleanup();
        resolve(api);
      };
      const handleError = (event: Event) => {
        fail("Google sign-in could not be loaded. Check your connection and try again.", event);
      };

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      timeoutId = window.setTimeout(() => {
        fail("Google sign-in took too long to load. Refresh and try again.");
      }, GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS);

      if (created) {
        script.id = GOOGLE_IDENTITY_SCRIPT_ID;
        script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.append(script);
      }
    }).catch((error: unknown) => {
      if (this.scriptPromise === promise) {
        this.scriptPromise = undefined;
      }
      throw error;
    });

    this.scriptPromise = promise;
    return promise;
  }

  private handleTokenResponse(response: GoogleTokenResponse): void {
    if (this.pendingConnection === undefined) {
      return;
    }

    if (response.error !== undefined) {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          response.error === "access_denied" ? "CONSENT_DENIED" : "POPUP_FAILED",
          response.error_description ??
            (response.error === "access_denied"
              ? "Google Calendar access was not granted."
              : "Google sign-in did not complete."),
        ),
      );
      return;
    }

    const accessToken = response.access_token?.trim();
    if (accessToken === undefined || accessToken.length === 0) {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "INVALID_TOKEN_RESPONSE",
          "Google sign-in completed without an access token. Try again.",
        ),
      );
      return;
    }

    const api = oauth2Api();
    const grantedAllScopes =
      api?.hasGrantedAllScopes !== undefined
        ? api.hasGrantedAllScopes(response, ...GOOGLE_CALENDAR_SCOPES)
        : this.responseHasAllScopes(response);
    if (!grantedAllScopes) {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "MISSING_SCOPES",
          "Calendar access is incomplete. Reconnect and grant both requested permissions.",
        ),
      );
      return;
    }

    const expiresIn = response.expires_in;
    if (
      expiresIn === undefined ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "INVALID_TOKEN_RESPONSE",
          "Google sign-in returned an invalid token lifetime. Try again.",
        ),
      );
      return;
    }

    const pending = this.pendingConnection;
    this.pendingConnection = undefined;
    pending.resolve({
      accessToken,
      expiresAt: Date.now() + expiresIn * 1_000,
    });
  }

  private handlePopupError(error: GooglePopupError): void {
    const type = error.type;
    if (type === "popup_closed") {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "POPUP_CLOSED",
          "Google sign-in was closed before it finished.",
        ),
      );
      return;
    }

    if (type === "popup_failed_to_open") {
      this.settleConnectionWithError(
        new GoogleCalendarIntegrationError(
          "POPUP_BLOCKED",
          "Google sign-in was blocked. Allow popups and try again.",
        ),
      );
      return;
    }

    this.settleConnectionWithError(
      new GoogleCalendarIntegrationError(
        "POPUP_FAILED",
        error.message ?? "Google sign-in could not be completed.",
      ),
    );
  }

  private responseHasAllScopes(response: GoogleTokenResponse): boolean {
    const grantedScopes = new Set(
      (response.scope ?? "").split(/\s+/u).filter((scope) => scope.length > 0),
    );
    return GOOGLE_CALENDAR_SCOPES.every((scope) => grantedScopes.has(scope));
  }

  private settleConnectionWithError(error: GoogleCalendarIntegrationError): void {
    const pending = this.pendingConnection;
    if (pending === undefined) {
      return;
    }
    this.pendingConnection = undefined;
    pending.reject(error);
  }

  private async revoke(accessToken: string): Promise<void> {
    const api = await this.loadGoogleIdentityServices();

    await new Promise<void>((resolve, reject) => {
      try {
        api.revoke(accessToken, (response) => {
          if (response?.successful === false || response?.error !== undefined) {
            reject(
              new GoogleCalendarIntegrationError(
                "REVOCATION_FAILED",
                response.error_description ??
                  "Google Calendar access could not be disconnected.",
              ),
            );
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(
          new GoogleCalendarIntegrationError(
            "REVOCATION_FAILED",
            "Google Calendar access could not be disconnected.",
            { cause: error },
          ),
        );
      }
    });
  }
}

export const browserGoogleCalendarIntegration =
  new GoogleCalendarBrowserIntegration();
