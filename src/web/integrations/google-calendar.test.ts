/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarBrowserIntegration,
  GoogleCalendarIntegrationError,
} from "./google-calendar.js";

type GoogleOAuth2 = NonNullable<typeof window.google>["accounts"]["oauth2"];
type TokenClientConfig = Parameters<GoogleOAuth2["initTokenClient"]>[0];
type RevokeCallback = Parameters<GoogleOAuth2["revoke"]>[1];

interface GoogleHarnessOptions {
  grantsAllScopes?: boolean;
  revokeImmediately?: boolean;
}

function installGoogle(options: GoogleHarnessOptions = {}) {
  let tokenConfig: TokenClientConfig | undefined;
  let revokeCallback: RevokeCallback | undefined;
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn((config: TokenClientConfig) => {
    tokenConfig = config;
    return { requestAccessToken };
  });
  const hasGrantedAllScopes = vi.fn(
    () => options.grantsAllScopes ?? true,
  );
  const revoke = vi.fn((_: string, callback: RevokeCallback) => {
    revokeCallback = callback;
    if (options.revokeImmediately !== false) {
      callback({ successful: true });
    }
  });

  Object.defineProperty(window, "google", {
    configurable: true,
    value: {
      accounts: {
        oauth2: {
          initTokenClient,
          hasGrantedAllScopes,
          revoke,
        },
      },
    },
    writable: true,
  });

  return {
    getTokenConfig: () => {
      if (tokenConfig === undefined) {
        throw new Error("Google token client was not initialized");
      }
      return tokenConfig;
    },
    getRevokeCallback: () => {
      if (revokeCallback === undefined) {
        throw new Error("Google revoke was not requested");
      }
      return revokeCallback;
    },
    hasGrantedAllScopes,
    initTokenClient,
    requestAccessToken,
    revoke,
  };
}

afterEach(() => {
  document
    .querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')
    .forEach((script) => {
      script.remove();
    });
  delete window.google;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GoogleCalendarBrowserIntegration", () => {
  it("loads Google Identity Services once and prepares the requested scopes", async () => {
    const integration = new GoogleCalendarBrowserIntegration();

    const firstPreparation = integration.prepare("client-id.apps.googleusercontent.com");
    const secondPreparation = integration.prepare("client-id.apps.googleusercontent.com");
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    expect(script?.defer).toBe(true);

    const google = installGoogle();
    script?.dispatchEvent(new Event("load"));
    await Promise.all([firstPreparation, secondPreparation]);

    expect(google.initTokenClient).toHaveBeenCalledTimes(1);
    expect(google.getTokenConfig()).toMatchObject({
      client_id: "client-id.apps.googleusercontent.com",
      include_granted_scopes: true,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    });
  });

  it("surfaces a failed GIS script load and permits a later retry", async () => {
    const integration = new GoogleCalendarBrowserIntegration();

    const failedPreparation = integration.prepare("client-id");
    const failedScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    failedScript?.dispatchEvent(new Event("error"));

    await expect(failedPreparation).rejects.toMatchObject({
      code: "SCRIPT_LOAD_FAILED",
    });
    expect(failedScript?.isConnected).toBe(false);

    const retriedPreparation = integration.prepare("client-id");
    const retryScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const google = installGoogle();
    retryScript?.dispatchEvent(new Event("load"));

    await expect(retriedPreparation).resolves.toBeUndefined();
    expect(google.initTokenClient).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent popup requests and returns a short-lived token", async () => {
    const google = installGoogle();
    const integration = new GoogleCalendarBrowserIntegration();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await integration.prepare("client-id");

    const firstConnection = integration.connect();
    const secondConnection = integration.connect();

    expect(firstConnection).toBe(secondConnection);
    expect(google.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(google.requestAccessToken).toHaveBeenCalledWith();

    google.getTokenConfig().callback({
      access_token: "short-lived-access-token",
      expires_in: 3_600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });

    await expect(firstConnection).resolves.toEqual({
      accessToken: "short-lived-access-token",
      expiresAt: 4_600_000,
    });
    await expect(secondConnection).resolves.toEqual({
      accessToken: "short-lived-access-token",
      expiresAt: 4_600_000,
    });
    expect(google.hasGrantedAllScopes).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "short-lived-access-token" }),
      ...GOOGLE_CALENDAR_SCOPES,
    );
  });

  it("rejects denied or partial calendar consent with readable errors", async () => {
    const deniedGoogle = installGoogle();
    const deniedIntegration = new GoogleCalendarBrowserIntegration();
    await deniedIntegration.prepare("client-id");

    const deniedConnection = deniedIntegration.connect();
    deniedGoogle.getTokenConfig().callback({
      error: "access_denied",
      error_description: "The user declined the request.",
    });
    await expect(deniedConnection).rejects.toMatchObject({
      code: "CONSENT_DENIED",
      message: "The user declined the request.",
    });

    delete window.google;
    const partialGoogle = installGoogle({ grantsAllScopes: false });
    const partialIntegration = new GoogleCalendarBrowserIntegration();
    await partialIntegration.prepare("client-id");

    const partialConnection = partialIntegration.connect();
    partialGoogle.getTokenConfig().callback({
      access_token: "partial-token",
      expires_in: 3_600,
      scope: GOOGLE_CALENDAR_SCOPES[0],
      token_type: "Bearer",
    });
    await expect(partialConnection).rejects.toMatchObject({
      code: "MISSING_SCOPES",
    });
  });

  it.each([
    ["popup_closed", "POPUP_CLOSED"],
    ["popup_failed_to_open", "POPUP_BLOCKED"],
  ] as const)("maps %s popup failures to %s", async (type, code) => {
    const google = installGoogle();
    const integration = new GoogleCalendarBrowserIntegration();
    await integration.prepare("client-id");

    const connection = integration.connect();
    google.getTokenConfig().error_callback({ type });

    await expect(connection).rejects.toMatchObject({ code });
  });

  it("verifies and counts every page of writable calendar access", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: "primary", primary: true, summary: "Evan's calendar" },
              { id: "team", summary: "Standby" },
            ],
            nextPageToken: "next page",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "bookings" }] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const integration = new GoogleCalendarBrowserIntegration();

    await expect(integration.verify("access-token")).resolves.toEqual({
      calendarCount: 3,
      primaryCalendarName: "Evan's calendar",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("maxResults=250");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("pageToken=next+page");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer access-token",
        },
      }),
    );
  });

  it("turns expired and denied Calendar API responses into actionable errors", async () => {
    const integration = new GoogleCalendarBrowserIntegration();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
          status: 401,
        }),
      ),
    );

    await expect(integration.verify("expired-token")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      status: 401,
      message: "Google Calendar access expired. Connect again to continue.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Calendar API disabled" } }), {
          status: 403,
        }),
      ),
    );
    await expect(integration.verify("denied-token")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
      message: "Calendar API disabled",
    });
  });

  it("deduplicates concurrent disconnects and revokes the token", async () => {
    const google = installGoogle({ revokeImmediately: false });
    const integration = new GoogleCalendarBrowserIntegration();
    await integration.prepare("client-id");

    const firstDisconnect = integration.disconnect("access-token");
    const secondDisconnect = integration.disconnect("access-token");

    expect(firstDisconnect).toBe(secondDisconnect);
    await Promise.resolve();
    expect(google.revoke).toHaveBeenCalledTimes(1);
    expect(google.revoke).toHaveBeenCalledWith(
      "access-token",
      expect.any(Function),
    );

    google.getRevokeCallback()({ successful: true });
    await expect(firstDisconnect).resolves.toBeUndefined();
    await expect(secondDisconnect).resolves.toBeUndefined();
  });

  it("uses a typed integration error for caller-friendly handling", () => {
    const error = new GoogleCalendarIntegrationError(
      "AUTH_EXPIRED",
      "Reconnect Google Calendar.",
      { status: 401 },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "GoogleCalendarIntegrationError",
      code: "AUTH_EXPIRED",
      status: 401,
    });
  });
});
