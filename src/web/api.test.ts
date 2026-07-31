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

  it("loads the entire Agent workspace with one snapshot request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      conversations: [],
      waitlist: [],
      activity: [],
      generatedAt: "2026-07-20T12:00:00.000Z",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      defaultApi.getOperatorSnapshot?.(),
      defaultApi.getOperatorSnapshot?.(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/operator-snapshot",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("loads the customer table and selected record with one snapshot request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      customers: [],
      generatedAt: "2026-07-20T12:00:00.000Z",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      defaultApi.getCustomerWorkspace?.("alex"),
      defaultApi.getCustomerWorkspace?.("alex"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/customer-workspace?selectedId=alex",
      expect.objectContaining({ headers: {} }),
    );
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
