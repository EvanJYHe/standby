// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StandbyApiError } from "../api.js";
import type { GoogleCalendarIntegration } from "../integrations/google-calendar.js";
import type { CalendarView } from "../lib/dates.js";
import type { CalendarResponse, StandbyApi, SchedulingSettings } from "../types.js";
import { CalendarPage } from "./CalendarPage.js";

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

function calendar(): CalendarResponse {
  return {
    date: "2026-07-20",
    range: { start: "2026-07-20", end: "2026-08-30" },
    timezone: "America/Toronto",
    generatedAt: "2026-07-18T16:00:00.000Z",
    demoDate: "2026-07-20",
    shop: { name: "Standby", location: "Toronto, ON" },
    businessHours: { start: "10:00", end: "20:00" },
    barbers: [
      { id: "jeremy", name: "Jeremy", serviceIds: ["haircut"], weeklyHours: {} },
      { id: "maya", name: "Maya", serviceIds: ["haircut", "fade"], weeklyHours: {} },
      { id: "devon", name: "Devon", serviceIds: ["haircut"], weeklyHours: {} },
    ],
    services: [
      { id: "haircut", name: "Signature haircut", durationMinutes: 60, priceCents: 4500 },
      { id: "fade", name: "Skin fade", durationMinutes: 60, priceCents: 5200 },
      { id: "beard", name: "Beard sculpt", durationMinutes: 30, priceCents: 2800 },
    ],
    appointments: [
      {
        id: "sarah-appt",
        customerId: "sarah",
        customerName: "Sarah",
        barberId: "jeremy",
        barberName: "Jeremy",
        serviceId: "haircut",
        serviceName: "Signature haircut",
        startAt: "2026-07-20T22:00:00.000Z",
        endAt: "2026-07-20T23:00:00.000Z",
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
      {
        id: "josh-appt",
        customerId: "josh",
        customerName: "Josh",
        barberId: "jeremy",
        barberName: "Jeremy",
        serviceId: "haircut",
        serviceName: "Signature haircut",
        startAt: "2026-07-20T21:00:00.000Z",
        endAt: "2026-07-20T22:00:00.000Z",
        status: "cancelled",
        discountPercent: 0,
        version: 2,
        history: [],
      },
      {
        id: "nadia-appt",
        customerId: "nadia",
        customerName: "Nadia",
        barberId: "maya",
        barberName: "Maya",
        serviceId: "fade",
        serviceName: "Skin fade",
        startAt: "2026-07-20T17:00:00.000Z",
        endAt: "2026-07-20T18:00:00.000Z",
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
      {
        id: "eli-short",
        customerId: "eli",
        customerName: "Eli",
        barberId: "devon",
        barberName: "Devon",
        serviceId: "beard",
        serviceName: "Beard sculpt",
        startAt: "2026-07-20T19:00:00.000Z",
        endAt: "2026-07-20T19:30:00.000Z",
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
      {
        id: "eli-tue",
        customerId: "eli",
        customerName: "Eli",
        barberId: "devon",
        barberName: "Devon",
        serviceId: "haircut",
        serviceName: "Signature haircut",
        startAt: "2026-07-21T16:00:00.000Z",
        endAt: "2026-07-21T17:00:00.000Z",
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
    ],
    activeRefills: [{
      id: "job-1",
      sourceAppointmentId: "josh-appt",
      barberId: "jeremy",
      barberName: "Jeremy",
      serviceId: "haircut",
      serviceName: "Signature haircut",
      slotStartAt: "2026-07-20T21:00:00.000Z",
      slotEndAt: "2026-07-20T22:00:00.000Z",
      status: "awaiting_offer",
      moveDepth: 0,
      attemptedCustomerIds: ["sarah"],
      currentOfferId: "offer-1",
      customerState: "Waiting for Sarah.",
      timeline: [
        { type: "opening_created", at: "2026-07-20T16:00:00.000Z", message: "Josh cancelled his 5 PM appointment." },
        { type: "offer_delivered", at: "2026-07-20T16:00:05.000Z", message: "Standby called Sarah." },
      ],
      version: 2,
      createdAt: "2026-07-20T16:00:00.000Z",
      updatedAt: "2026-07-20T16:00:05.000Z",
    }],
    channelHealth: { mongodb: "mongodb", telegram: "configured", backboard: "configured", elevenlabs: "configured" },
  };
}

function api(): StandbyApi {
  return {
    getGoogleCalendarOAuthConfig: vi.fn(async () => ({ configured: false as const })),
    getCalendar: vi.fn(async () => calendar()),
    getCalendarRange: vi.fn(async () => calendar()),
    getAvailability: vi.fn(async () => ({
      date: "2026-07-20",
      timezone: "America/Toronto",
      service: { id: "haircut", name: "Signature haircut", durationMinutes: 60 },
      slots: [{
        barberId: "jeremy",
        barberName: "Jeremy",
        startAt: "2026-07-20T19:00:00.000Z",
        endAt: "2026-07-20T20:00:00.000Z",
        localTime: "3:00 PM",
      }],
    })),
    getSettings: vi.fn(async () => settings),
    patchSettings: vi.fn(async (patch) => ({ ...settings, ...patch })),
    resetDemo: vi.fn(async () => ({ status: "reset", demoDate: "2026-07-20" })),
    getCustomers: vi.fn(async () => [{
      id: "alex",
      name: "Alex",
      contactPreference: "telegram" as const,
      identitySummary: "Telegram linked",
      activeWaitlistCount: 1,
      bookingState: "waitlisted" as const,
      bookingStateLabel: "Waitlisted",
      visitCount: 3,
      outreachEligible: false,
      matchReason: "Actively waiting for Signature haircut in a preferred time window.",
      waitlistRequestSummary: "Signature haircut · Jeremy · Mon, Jul 20, 5:00 PM–7:00 PM",
    }]),
    getCustomer: vi.fn(async () => { throw new Error("unused"); }),
    patchCustomer: vi.fn(async () => { throw new Error("unused"); }),
    addCustomerNote: vi.fn(async () => { throw new Error("unused"); }),
    createCustomer: vi.fn(async () => ({ id: "new-customer", name: "New Customer", contactPreference: "telegram" as const, identitySummary: "No linked channel", activeWaitlistCount: 0, bookingState: "not_eligible" as const, bookingStateLabel: "Not eligible", visitCount: 0, outreachEligible: false, matchReason: "New customer." })),
    getConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => { throw new Error("unused"); }),
    getWaitlist: vi.fn(async () => []),
    patchWaitlist: vi.fn(async () => { throw new Error("unused"); }),
    getActivity: vi.fn(async () => []),
    bookAppointment: vi.fn(async () => ({ type: "committed" as const, operation: "book", message: "Booked" })),
    rescheduleAppointment: vi.fn(async () => ({ type: "committed" as const, operation: "reschedule", message: "Moved" })),
    cancelAppointment: vi.fn(async () => ({ type: "committed" as const, operation: "cancel", message: "Cancelled" })),
    cancelRefillJob: vi.fn(async (id) => ({ id, status: "cancelled" })),
  };
}

function Harness({
  client = api(),
  googleCalendarIntegration,
}: {
  client?: StandbyApi;
  googleCalendarIntegration?: GoogleCalendarIntegration;
}) {
  const [view, setView] = useState<CalendarView>("day");
  const [date, setDate] = useState("2026-07-20");
  const [barber, setBarber] = useState("all");
  return (
    <CalendarPage
      anchorDate={date}
      api={client}
      barberFilter={barber}
      calendar={calendar()}
      googleCalendarIntegration={googleCalendarIntegration}
      loading={false}
      onAnchorDateChange={setDate}
      onBarberFilterChange={setBarber}
      onMutated={vi.fn(async () => undefined)}
      onViewChange={setView}
      view={view}
    />
  );
}

afterEach(cleanup);

describe("CalendarPage", () => {
  it("keeps the barber filter quiet while calendar data refreshes", () => {
    render(
      <CalendarPage
        anchorDate="2026-07-20"
        api={api()}
        barberFilter="all"
        calendar={calendar()}
        loading
        onAnchorDateChange={vi.fn()}
        onBarberFilterChange={vi.fn()}
        onMutated={vi.fn(async () => undefined)}
        onViewChange={vi.fn()}
        view="day"
      />,
    );

    expect(screen.queryByText("Syncing")).not.toBeInTheDocument();
  });

  it("renders the clean day grid, filters barbers, and hides cancelled cards", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByLabelText("July 2026 mini calendar")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Jeremy" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Maya" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Devon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sarah, Signature haircut/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nadia, Skin fade/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Josh, Signature haircut/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Maya" }));
    expect(screen.getByRole("columnheader", { name: "Maya" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Jeremy" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sarah")).not.toBeInTheDocument();
  });

  it("uses a compact business-day grid and concise copy for short appointments", () => {
    render(<Harness />);

    const calendarRegion = screen.getByLabelText("Day calendar");
    expect(calendarRegion).toHaveAttribute("data-start-hour", "8");
    expect(calendarRegion).toHaveAttribute("data-end-hour", "21");
    expect(calendarRegion).not.toHaveClass("overflow-x-auto");
    expect(within(calendarRegion).getByText("8 AM")).not.toHaveClass("-translate-y-1/2");
    expect(within(calendarRegion).getByText("8 PM")).toBeInTheDocument();
    expect(within(calendarRegion).getByTestId("calendar-scroll-region")).toHaveClass("overflow-y-auto");

    const shortAppointment = screen.getByRole("button", { name: /Eli, Beard sculpt/ });
    expect(shortAppointment).toHaveAttribute("data-density", "compact");
    expect(shortAppointment).toHaveAttribute("data-visual", "solid");
    expect(within(shortAppointment).getByText("Eli · Beard sculpt")).toBeInTheDocument();
    expect(within(shortAppointment).getByText("3:00 PM · Devon")).toBeInTheDocument();

    const fullAppointment = screen.getByRole("button", { name: /Sarah, Signature haircut/ });
    expect(fullAppointment).not.toHaveClass("border-l-[3px]");
    expect(fullAppointment.style.borderLeftColor).toBe("");
    expect(within(fullAppointment).getByText("6:00 PM–7:00 PM")).toBeInTheDocument();
    expect(within(fullAppointment).getByText("Jeremy")).toBeInTheDocument();
  });

  it("switches among day, week, and month and opens a month date in day view", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByLabelText("Week calendar")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Week calendar")).getByText("Tue")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Week calendar")).getByText("21")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByLabelText("Month calendar")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Month calendar")).getByText("Sun")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Open Monday, July 20" })).getByText("1:00 PM Nadia")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Tuesday, July 21" }));
    expect(screen.getByLabelText("Day calendar")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, July 21")).toBeInTheDocument();
  });

  it("opens Google authorization, verifies Calendar access, and revokes it", async () => {
    const user = userEvent.setup();
    const client = api();
    client.getGoogleCalendarOAuthConfig = vi.fn(async () => ({
      configured: true,
      clientId: "standby.apps.googleusercontent.com",
    }));
    const googleCalendarIntegration: GoogleCalendarIntegration = {
      prepare: vi.fn(async () => undefined),
      connect: vi.fn(async () => ({
        accessToken: "short-lived-token",
        expiresAt: Date.now() + 3_600_000,
      })),
      verify: vi.fn(async () => ({
        calendarCount: 2,
        primaryCalendarName: "Evan's calendar",
      })),
      disconnect: vi.fn(async () => undefined),
    };
    render(
      <Harness
        client={client}
        googleCalendarIntegration={googleCalendarIntegration}
      />,
    );

    const integrations = screen.getByRole("region", { name: "Calendar integrations" });
    const connectButton = await within(integrations).findByRole("button", { name: "Connect Google Calendar" });
    await waitFor(() => expect(within(connectButton).getByText("Not connected")).toBeInTheDocument());
    await user.click(connectButton);
    expect(await within(integrations).findByText("Connected · 2 calendars")).toBeInTheDocument();
    expect(googleCalendarIntegration.prepare).toHaveBeenCalledWith("standby.apps.googleusercontent.com");
    expect(googleCalendarIntegration.connect).toHaveBeenCalledTimes(1);
    expect(googleCalendarIntegration.verify).toHaveBeenCalledWith("short-lived-token");
    expect(screen.getByText("Google Calendar connected · Evan's calendar.")).toBeInTheDocument();

    await user.click(within(integrations).getByRole("button", { name: "Check Google Calendar access" }));
    expect(await screen.findByText("Google Calendar access verified.")).toBeInTheDocument();
    expect(googleCalendarIntegration.verify).toHaveBeenCalledTimes(2);

    await user.click(within(integrations).getByRole("button", { name: "Disconnect Google Calendar" }));
    const reconnectedButton = await within(integrations).findByRole("button", { name: "Connect Google Calendar" });
    expect(within(reconnectedButton).getByText("Not connected")).toBeInTheDocument();
    expect(googleCalendarIntegration.disconnect).toHaveBeenCalledWith("short-lived-token");

    await user.click(screen.getByRole("button", { name: "Connect Outlook Calendar" }));
    expect(screen.getByText("Outlook Calendar is not available in this build yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect Outlook Calendar" })).not.toBeInTheDocument();
  });

  it("never claims Google Calendar is connected without OAuth configuration", async () => {
    const user = userEvent.setup();
    const googleCalendarIntegration: GoogleCalendarIntegration = {
      prepare: vi.fn(async () => undefined),
      connect: vi.fn(async () => { throw new Error("must not open"); }),
      verify: vi.fn(async () => ({ calendarCount: 0 })),
      disconnect: vi.fn(async () => undefined),
    };
    render(<Harness googleCalendarIntegration={googleCalendarIntegration} />);

    const integrations = screen.getByRole("region", { name: "Calendar integrations" });
    expect(await within(integrations).findByText("Setup required")).toBeInTheDocument();
    await user.click(within(integrations).getByRole("button", { name: "Connect Google Calendar" }));
    expect(screen.getByText("Google Calendar needs an OAuth client ID before it can connect.")).toBeInTheDocument();
    expect(googleCalendarIntegration.prepare).not.toHaveBeenCalled();
    expect(googleCalendarIntegration.connect).not.toHaveBeenCalled();
    expect(screen.queryByText(/two-way sync/i)).not.toBeInTheDocument();
  });

  it("opens focused appointment and refill detail drawers", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<Harness client={client} />);

    await user.click(screen.getByRole("button", { name: /Sarah, Signature haircut/ }));
    expect(within(screen.getByRole("dialog", { name: "Appointment details" })).getByText("Jeremy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close Appointment details" }));
    const refillCard = screen.getByRole("button", { name: /Waiting for Sarah/ });
    expect(refillCard.querySelector(".rounded-full")).toBeNull();
    await user.click(refillCard);
    const refill = screen.getByRole("dialog", { name: "Refill timeline" });
    expect(within(refill).getByText("Josh cancelled his 5 PM appointment.")).toBeInTheDocument();
    expect(within(refill).getByText("Standby called Sarah.")).toBeInTheDocument();
    expect(refill.querySelector(".rounded-full.bg-standby")).toBeNull();
    await user.click(within(refill).getByRole("button", { name: "Close Open Chair" }));
    await user.click(within(refill).getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(client.cancelRefillJob).toHaveBeenCalledWith("job-1"));
  });

  it("books from live availability and refetches after confirmation", async () => {
    const user = userEvent.setup();
    const client = api();
    const mutated = vi.fn(async () => undefined);
    render(
      <CalendarPage
        anchorDate="2026-07-20"
        api={client}
        barberFilter="all"
        calendar={calendar()}
        loading={false}
        onAnchorDateChange={vi.fn()}
        onBarberFilterChange={vi.fn()}
        onMutated={mutated}
        onViewChange={vi.fn()}
        view="day"
      />,
    );

    await user.click(screen.getByRole("button", { name: "New appointment" }));
    const dialog = screen.getByRole("dialog", { name: "New appointment" });
    expect(dialog).not.toHaveClass("shadow-panel");
    expect(dialog).toHaveClass("modal-panel", "rounded-[14px]", "border", "border-line", "bg-panel");
    await waitFor(() => expect(client.getCustomers).toHaveBeenCalled());
    await waitFor(() => expect(client.getAvailability).toHaveBeenCalled());
    expect(within(dialog).getByLabelText("Customer")).toHaveClass("rounded-standby");
    await user.selectOptions(within(dialog).getByLabelText("Time"), "2026-07-20T19:00:00.000Z");
    await user.click(within(dialog).getByRole("button", { name: "Confirm appointment" }));

    await waitFor(() => expect(client.bookAppointment).toHaveBeenCalledWith({
      customerId: "alex",
      barberId: "jeremy",
      serviceId: "haircut",
      startAt: "2026-07-20T19:00:00.000Z",
    }));
    expect(mutated).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "New appointment" })).not.toBeInTheDocument();
  });

  it("keeps the editor open when another change wins the slot", async () => {
    const user = userEvent.setup();
    const client = api();
    client.bookAppointment = vi.fn(async () => {
      throw new StandbyApiError("That time was just taken.", 409, "STALE_SLOT");
    });
    render(<Harness client={client} />);

    await user.click(screen.getByRole("button", { name: "New appointment" }));
    const dialog = screen.getByRole("dialog", { name: "New appointment" });
    await waitFor(() => expect(client.getAvailability).toHaveBeenCalled());
    await user.selectOptions(within(dialog).getByLabelText("Time"), "2026-07-20T19:00:00.000Z");
    await user.click(within(dialog).getByRole("button", { name: "Confirm appointment" }));

    expect(await within(dialog).findByText("That time was just taken.")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it("shows the shop hours when a weekend date is selected", async () => {
    const user = userEvent.setup();
    const client = api();
    client.getAvailability = vi.fn(async ({ date }) => ({
      date,
      timezone: "America/Toronto",
      service: { id: "haircut", name: "Signature haircut", durationMinutes: 60 },
      slots: [],
      closed: true,
      message: "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.",
    }));
    render(<Harness client={client} />);

    await user.click(screen.getByRole("button", { name: "New appointment" }));
    const dialog = screen.getByRole("dialog", { name: "New appointment" });
    await user.clear(within(dialog).getByLabelText("Date"));
    await user.type(within(dialog).getByLabelText("Date"), "2026-07-25");

    expect(await within(dialog).findByText(
      "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.",
    )).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm appointment" })).toBeDisabled();
  });
});
