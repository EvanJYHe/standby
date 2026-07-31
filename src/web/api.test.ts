import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultApi } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Standby browser API", () => {
  it("requests authoritative calendar ranges", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ range: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await defaultApi.getCalendarRange("2026-07-20", "2026-07-24");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/calendar?start=2026-07-20&end=2026-07-24",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("uses tokenless local operator reads and exposes no admin-session client", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await defaultApi.getCustomers("sar ah");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/customers?q=sar%20ah",
      expect.objectContaining({ headers: {} }),
    );
    expect("createAdminSession" in defaultApi).toBe(false);
  });

  it("surfaces stale appointment conflicts with their HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      type: "conflict",
      code: "STALE_SLOT",
      message: "That time was just taken.",
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })));

    await expect(defaultApi.bookAppointment({
      customerId: "alex",
      barberId: "jeremy",
      serviceId: "haircut",
      startAt: "2026-07-20T20:00:00.000Z",
    })).rejects.toMatchObject({
      status: 409,
      message: "That time was just taken.",
    });
  });
});
