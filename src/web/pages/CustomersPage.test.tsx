// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomersPage } from "./CustomersPage.js";
import type {
  CalendarAppointment,
  CustomerDetail,
  CustomerSummary,
  StandbyApi,
  SchedulingSettings,
} from "../types.js";

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

const summaries: CustomerSummary[] = [
  {
    id: "alex",
    name: "Alex",
    contactPreference: "telegram",
    identitySummary: "Telegram linked",
    activeWaitlistCount: 1,
    bookingState: "waitlisted",
    bookingStateLabel: "Waitlisted",
    visitCount: 5,
    outreachEligible: false,
    matchReason: "Actively waiting for Signature haircut in a preferred time window.",
    waitlistRequestSummary: "Signature haircut · Jeremy · Mon, Jul 20, 5:00 PM–7:00 PM",
    lastVisitAt: "2026-06-12T18:00:00.000Z",
    usualServiceName: "Signature haircut",
    usualBarberName: "Jeremy",
  },
  {
    id: "sarah",
    name: "Sarah",
    contactPreference: "voice",
    identitySummary: "Phone linked",
    activeWaitlistCount: 0,
    bookingState: "booked",
    bookingStateLabel: "Booked",
    visitCount: 7,
    outreachEligible: false,
    matchReason: "Already confirmed for Signature haircut with Jeremy.",
    nextAppointmentAt: "2026-08-03T22:00:00.000Z",
    nextBarberName: "Jeremy",
    nextServiceName: "Signature haircut",
    lastVisitAt: "2026-06-19T18:00:00.000Z",
    usualServiceName: "Signature haircut",
    usualBarberName: "Jeremy",
  },
  {
    id: "olivia",
    name: "Olivia",
    contactPreference: "voice",
    identitySummary: "Phone linked",
    activeWaitlistCount: 0,
    bookingState: "outreach_ready",
    bookingStateLabel: "Ready to contact",
    visitCount: 4,
    outreachEligible: true,
    matchReason: "Returning Signature haircut customer · 4 visits · outreach allowed.",
    lastVisitAt: "2026-06-22T18:00:00.000Z",
    usualServiceName: "Signature haircut",
    usualBarberName: "Maya",
  },
  {
    id: "zoe",
    name: "Zoe",
    contactPreference: "telegram",
    identitySummary: "Telegram linked",
    activeWaitlistCount: 0,
    bookingState: "not_eligible",
    bookingStateLabel: "Not eligible",
    visitCount: 2,
    outreachEligible: false,
    matchReason: "No upcoming booking · automated outreach is off.",
    lastVisitAt: "2026-06-30T18:00:00.000Z",
    usualServiceName: "Skin fade",
    usualBarberName: "Maya",
  },
];

function customer(id: string): CustomerDetail {
  const sarah = id === "sarah";
  const summary = summaries.find((candidate) => candidate.id === id)!;
  const upcoming: CalendarAppointment[] = sarah ? [{
    id: `${id}-future`,
    customerId: id,
    customerName: summary.name,
    barberId: "jeremy",
    barberName: "Jeremy",
    serviceId: "haircut",
    serviceName: "Signature haircut",
    startAt: "2026-08-03T22:00:00.000Z",
    endAt: "2026-08-03T23:00:00.000Z",
    status: "confirmed",
    discountPercent: 0,
    version: 1,
    history: [],
  }] : [];
  return {
    id,
    name: summary.name,
    identities: sarah
      ? { telegram: "Not linked", phone: "••• ••• 0101" }
      : { telegram: "Linked account", phone: "Not linked" },
    preferences: {
      contactPreference: sarah ? "voice" : "telegram",
      replacementOffersEnabled: true,
      earlierMoveConsent: sarah,
      flexibleBarberPreference: false,
      pastCustomerOptIn: sarah,
    },
    relationship: {
      bookingState: summary.bookingState,
      bookingStateLabel: summary.bookingStateLabel,
      activeWaitlistCount: summary.activeWaitlistCount,
      visitCount: summary.visitCount,
      outreachEligible: summary.outreachEligible,
      matchReason: summary.matchReason,
      ...(summary.nextAppointmentAt === undefined ? {} : { nextAppointmentAt: summary.nextAppointmentAt }),
      ...(summary.nextBarberName === undefined ? {} : { nextBarberName: summary.nextBarberName }),
      ...(summary.nextServiceName === undefined ? {} : { nextServiceName: summary.nextServiceName }),
      ...(summary.waitlistRequestSummary === undefined ? {} : { waitlistRequestSummary: summary.waitlistRequestSummary }),
      ...(summary.lastVisitAt === undefined ? {} : { lastVisitAt: summary.lastVisitAt }),
      ...(summary.usualServiceName === undefined ? {} : { usualServiceName: summary.usualServiceName }),
      ...(summary.usualBarberName === undefined ? {} : { usualBarberName: summary.usualBarberName }),
    },
    appointments: [
      ...upcoming,
      {
        id: `${id}-past`,
        customerId: id,
        customerName: summary.name,
        barberId: "maya",
        barberName: "Maya",
        serviceId: "haircut",
        serviceName: "Signature haircut",
        startAt: "2026-07-10T18:00:00.000Z",
        endAt: "2026-07-10T19:00:00.000Z",
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
    ],
    waitlist: id === "alex" ? [{
      id: "waitlist-alex",
      customerId: "alex",
      customerName: "Alex",
      serviceId: "haircut",
      serviceName: "Signature haircut",
      barberId: "jeremy",
      barberName: "Jeremy",
      date: "2026-07-20",
      earliestStart: "2026-07-20T21:00:00.000Z",
      latestStart: "2026-07-20T23:00:00.000Z",
      status: "active",
      channel: "telegram",
      outreachState: "not_contacted",
      createdAt: "2026-07-18T16:00:00.000Z",
    }] : [],
    notes: [{
      id: `${id}-note`,
      text: sarah ? "Prefers a quick phone call." : "Usually free after work.",
      author: "operator",
      createdAt: "2026-07-18T16:00:00.000Z",
    }],
  };
}

function api(): StandbyApi {
  const details = new Map(summaries.map((summary) => [summary.id, customer(summary.id)]));
  return {
    getCalendar: vi.fn(async () => { throw new Error("unused"); }),
    getCalendarRange: vi.fn(async () => { throw new Error("unused"); }),
    getAvailability: vi.fn(async () => { throw new Error("unused"); }),
    getSettings: vi.fn(async () => settings),
    patchSettings: vi.fn(async (patch) => ({ ...settings, ...patch })),
    resetDemo: vi.fn(async () => ({ status: "reset", demoDate: "2026-07-20" })),
    getCustomers: vi.fn(async (query) => summaries.filter((summary) => summary.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))),
    getCustomer: vi.fn(async (id) => structuredClone(details.get(id)!)),
    patchCustomer: vi.fn(async (id, patch) => {
      const current = details.get(id)!;
      const updated = { ...current, preferences: { ...current.preferences, ...patch } };
      details.set(id, updated);
      return structuredClone(updated);
    }),
    addCustomerNote: vi.fn(async (id, text) => {
      const current = details.get(id)!;
      const note = { id: `note-${Date.now()}`, text, author: "operator" as const, createdAt: "2026-07-18T17:00:00.000Z" };
      details.set(id, { ...current, notes: [note, ...current.notes] });
      return note;
    }),
    createCustomer: vi.fn(async () => ({ id: "new-customer", name: "New Customer", contactPreference: "telegram" as const, identitySummary: "No linked channel", activeWaitlistCount: 0, bookingState: "not_eligible" as const, bookingStateLabel: "Not eligible", visitCount: 0, outreachEligible: false, matchReason: "New customer." })),
    getConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => { throw new Error("unused"); }),
    getWaitlist: vi.fn(async () => []),
    patchWaitlist: vi.fn(async () => { throw new Error("unused"); }),
    getActivity: vi.fn(async () => []),
    bookAppointment: vi.fn(async () => { throw new Error("unused"); }),
    rescheduleAppointment: vi.fn(async () => { throw new Error("unused"); }),
    cancelAppointment: vi.fn(async (appointmentId) => {
      for (const [id, current] of details) {
        const appointment = current.appointments.find((candidate) => candidate.id === appointmentId);
        if (appointment === undefined) continue;
        details.set(id, {
          ...current,
          appointments: current.appointments.map((candidate) => (
            candidate.id === appointmentId ? { ...candidate, status: "cancelled" as const } : candidate
          )),
        });
      }
      return { type: "committed" as const, operation: "cancel", message: "Cancelled" };
    }),
    cancelRefillJob: vi.fn(async () => { throw new Error("unused"); }),
  };
}

afterEach(cleanup);

describe("CustomersPage", () => {
  it("explains the AI booking pool and filters customers by actionable state", async () => {
    const user = userEvent.setup();
    render(<CustomersPage api={api()} refreshKey={0} />);

    expect(await screen.findByRole("heading", { name: "Customer intelligence" })).toBeInTheDocument();
    const allCustomers = screen.getByRole("button", { name: /All customers 4/ });
    expect(allCustomers).toBeInTheDocument();
    expect(allCustomers.parentElement).toHaveClass("rounded-[14px]");
    expect(screen.getByRole("button", { name: /Booked 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Waitlisted 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ready to contact 1/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ready to contact 1/ }));
    expect(screen.getByRole("button", { name: /Olivia/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sarah/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Olivia/ }));
    const record = await screen.findByRole("region", { name: "Olivia customer record" });
    expect(record.parentElement).toHaveClass("rounded-[14px]");
    expect(within(record).getByText("Ready to contact")).toBeInTheDocument();
    expect(within(record).getByText("Booking")).toBeInTheDocument();
    expect(within(record).getByText("4 visits")).toBeInTheDocument();
    expect(within(record).getByText("Signature haircut · Maya")).toBeInTheDocument();
    expect(within(record).getByText("Last Jun 22, 2026")).toBeInTheDocument();
  });

  it("searches customers and shows one masked operational record", async () => {
    const user = userEvent.setup();
    render(<CustomersPage api={api()} refreshKey={0} />);

    expect(await screen.findByRole("heading", { name: "Customer intelligence" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search customers" })).toHaveClass("rounded-standby");
    await user.click(await screen.findByRole("button", { name: /Sarah/ }));
    const record = await screen.findByRole("region", { name: "Sarah customer record" });

    expect(within(record).getByText("••• ••• 0101")).toBeInTheDocument();
    expect(within(record).getByText("Not linked")).toBeInTheDocument();
    expect(screen.queryByText("+14165550101")).not.toBeInTheDocument();
    for (const section of ["Preferences", "Appointments", "Waitlist", "Private notes"]) {
      expect(within(record).getByRole("heading", { name: section })).toBeInTheDocument();
    }
    expect(within(record).getByText("Upcoming")).toBeInTheDocument();
    expect(within(record).getByText("Past")).toBeInTheDocument();
    expect(within(record).getByText("Prefers a quick phone call.")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search customers" }));
    await user.type(screen.getByRole("searchbox", { name: "Search customers" }), "Sarah");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Alex/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Sarah/ })).toBeInTheDocument();
  });

  it("updates consent preferences and adds trimmed private notes", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<CustomersPage api={client} refreshKey={0} />);

    await user.click(await screen.findByRole("button", { name: /Sarah/ }));
    await screen.findByRole("region", { name: "Sarah customer record" });

    await user.click(screen.getByRole("checkbox", { name: "Offer earlier appointments" }));
    await waitFor(() => expect(client.patchCustomer).toHaveBeenCalledWith(
      "sarah",
      { earlierMoveConsent: false },
    ));
    await user.click(screen.getByRole("checkbox", { name: "Any qualified barber" }));
    await waitFor(() => expect(client.patchCustomer).toHaveBeenCalledWith(
      "sarah",
      { flexibleBarberPreference: true },
    ));
    await user.click(screen.getByRole("checkbox", { name: "Past-customer outreach" }));
    await waitFor(() => expect(client.patchCustomer).toHaveBeenCalledWith(
      "sarah",
      { pastCustomerOptIn: false },
    ));
    await user.click(screen.getByRole("checkbox", { name: "Receive replacement offers" }));
    await waitFor(() => expect(client.patchCustomer).toHaveBeenCalledWith(
      "sarah",
      { replacementOffersEnabled: false },
    ));

    await user.type(screen.getByLabelText("New private note"), "  Ask about a beard trim next time.  ");
    await user.click(screen.getByRole("button", { name: "Add private note" }));
    await waitFor(() => expect(client.addCustomerNote).toHaveBeenCalledWith(
      "sarah",
      "Ask about a beard trim next time.",
    ));
    expect(await screen.findByText("Ask about a beard trim next time.")).toBeInTheDocument();
    expect(client.getCustomer).toHaveBeenCalledTimes(7);
    expect(screen.queryByText(/segments|lifetime value|campaign/i)).not.toBeInTheDocument();
  });

  it("cancels an upcoming appointment only after inline confirmation", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<CustomersPage api={client} refreshKey={0} />);

    await user.click(await screen.findByRole("button", { name: /Sarah/ }));
    const record = await screen.findByRole("region", { name: "Sarah customer record" });
    await user.click(within(record).getByRole("button", { name: /Cancel Signature haircut/ }));

    expect(client.cancelAppointment).not.toHaveBeenCalled();
    expect(within(record).getByRole("button", { name: "Keep" })).toBeInTheDocument();
    await user.click(within(record).getByRole("button", { name: "Confirm cancel" }));

    await waitFor(() => expect(client.cancelAppointment).toHaveBeenCalledWith("sarah-future"));
    expect(await within(record).findByText("Appointment cancelled.")).toBeInTheDocument();
    expect(within(record).queryByRole("button", { name: /Cancel Signature haircut/ })).not.toBeInTheDocument();
  });
});
