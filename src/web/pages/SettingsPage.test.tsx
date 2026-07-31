// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage.js";
import type { StandbyApi, SchedulingSettings } from "../types.js";

const settings: SchedulingSettings = {
  timezone: "America/Toronto",
  refillEnabled: true,
  moveEarlierEnabled: true,
  moveLimit: 3,
  allowAlternateBarbers: true,
  waitlistEnabled: true,
  pastCustomerOutreachEnabled: true,
  maxDiscountPercent: 15,
  offerExpirySeconds: 120,
};

function api(): StandbyApi {
  let current = { ...settings };
  return {
    getGoogleCalendarOAuthConfig: vi.fn(async () => ({ configured: false as const })),
    getCalendar: vi.fn(async () => { throw new Error("unused"); }),
    getCalendarRange: vi.fn(async () => { throw new Error("unused"); }),
    getAvailability: vi.fn(async () => { throw new Error("unused"); }),
    getSettings: vi.fn(async () => ({ ...current })),
    patchSettings: vi.fn(async (patch) => {
      current = { ...current, ...patch };
      return { ...current };
    }),
    resetDemo: vi.fn(async () => ({ status: "reset", demoDate: "2026-07-20" })),
    getCustomers: vi.fn(async () => []),
    getCustomer: vi.fn(async () => { throw new Error("unused"); }),
    patchCustomer: vi.fn(async () => { throw new Error("unused"); }),
    addCustomerNote: vi.fn(async () => { throw new Error("unused"); }),
    createCustomer: vi.fn(async () => ({ id: "new-customer", name: "New Customer", contactPreference: "telegram" as const, identitySummary: "No linked channel", activeWaitlistCount: 0, bookingState: "not_eligible" as const, bookingStateLabel: "Not eligible", visitCount: 0, outreachEligible: false, matchReason: "New customer." })),
    getConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => { throw new Error("unused"); }),
    getWaitlist: vi.fn(async () => []),
    patchWaitlist: vi.fn(async () => { throw new Error("unused"); }),
    getActivity: vi.fn(async () => []),
    bookAppointment: vi.fn(async () => { throw new Error("unused"); }),
    rescheduleAppointment: vi.fn(async () => { throw new Error("unused"); }),
    cancelAppointment: vi.fn(async () => { throw new Error("unused"); }),
    cancelRefillJob: vi.fn(async () => { throw new Error("unused"); }),
  };
}

afterEach(cleanup);

describe("SettingsPage", () => {
  it("shows only behavior-backed automation settings", async () => {
    render(
      <SettingsPage
        api={api()}
        onReset={vi.fn(async () => undefined)}
        refreshKey={0}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const automation = screen.getByRole("heading", { name: "Automation" });
    expect(automation).toBeInTheDocument();
    expect(automation.closest("section")).toHaveClass("rounded-[14px]");
    expect(screen.getByRole("heading", { name: "Demo week" }).closest("section")).toHaveClass("rounded-[14px]");
    expect(screen.queryByRole("heading", { name: "Connections" })).not.toBeInTheDocument();
    for (const label of [
      "Automatic vacancy refill",
      "Offer earlier appointments",
      "Allow alternate barbers",
      "Use the waitlist",
      "Past-customer outreach",
    ]) {
      expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    }
    expect(screen.getByRole("spinbutton", { name: "Maximum appointment moves" })).toHaveValue(3);
    expect(screen.getByRole("spinbutton", { name: "Maximum discount percent" })).toHaveValue(15);
    expect(screen.getByRole("combobox", { name: "Offer expiry" })).toHaveValue("120");
    expect(screen.getByRole("combobox", { name: "Offer expiry" })).toHaveClass("rounded-standby");
    expect(screen.queryByText(/prompt editor|voice laboratory|analytics|API key/i)).not.toBeInTheDocument();
  });

  it("saves one policy at a time and confirms the local demo reset", async () => {
    const user = userEvent.setup();
    const client = api();
    const onReset = vi.fn(async () => undefined);
    render(
      <SettingsPage
        api={client}
        onReset={onReset}
        refreshKey={0}
      />,
    );

    await screen.findByRole("heading", { name: "Automation" });
    await user.click(screen.getByRole("checkbox", { name: "Automatic vacancy refill" }));
    await waitFor(() => expect(client.patchSettings).toHaveBeenCalledWith(
      { refillEnabled: false },
    ));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    const moveLimit = screen.getByRole("spinbutton", { name: "Maximum appointment moves" });
    await user.clear(moveLimit);
    await user.type(moveLimit, "2");
    await user.tab();
    await waitFor(() => expect(client.patchSettings).toHaveBeenCalledWith(
      { moveLimit: 2 },
    ));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset demo week" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Reset demo week" }));
    expect(screen.getByText("This restores the seeded week while preserving linked demo identities.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm demo reset" }));
    await waitFor(() => expect(client.resetDemo).toHaveBeenCalledWith());
    expect(onReset).toHaveBeenCalledOnce();
  });
});
