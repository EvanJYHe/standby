// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPage } from "./AgentPage.js";
import type {
  ActivityItem,
  ConversationDetail,
  ConversationSummary,
  OperatorWaitlistEntry,
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

const conversations: ConversationSummary[] = [
  {
    id: "conversation-alex",
    customerId: "alex",
    customerName: "Alex",
    channel: "telegram",
    direction: "outbound",
    state: "active",
    preview: "Yes, please reserve it.",
    updatedAt: "2026-07-20T22:02:00.000Z",
    hasException: true,
  },
  {
    id: "conversation-sarah",
    customerId: "sarah",
    customerName: "Sarah",
    channel: "voice",
    direction: "outbound",
    state: "completed",
    preview: "Yes, move me to five.",
    updatedAt: "2026-07-20T21:02:00.000Z",
    hasException: false,
  },
];

const detail: ConversationDetail = {
  conversation: conversations[0]!,
  events: [
    {
      id: "event-1",
      kind: "message",
      direction: "outbound",
      speaker: "agent",
      text: "A 6 PM chair opened with Jeremy.",
      occurredAt: "2026-07-20T22:00:00.000Z",
    },
    {
      id: "event-2",
      kind: "message",
      direction: "inbound",
      speaker: "customer",
      text: "Is the haircut still forty-five dollars?",
      occurredAt: "2026-07-20T22:01:00.000Z",
      metadata: { internalTool: "never render this JSON" },
    },
    {
      id: "event-3",
      kind: "action",
      speaker: "system",
      text: "Standby checked Jeremy's live availability.",
      occurredAt: "2026-07-20T22:01:30.000Z",
    },
    {
      id: "event-4",
      kind: "message",
      direction: "outbound",
      speaker: "agent",
      text: "Yes — the signature haircut is $45.",
      occurredAt: "2026-07-20T22:02:00.000Z",
    },
  ],
  activity: [
    {
      id: "activity-cancelled",
      type: "appointment.cancelled",
      occurredAt: "2026-07-20T21:58:00.000Z",
      message: "Alex's appointment was cancelled; Standby opened refill work.",
      customerId: "alex",
      customerName: "Alex",
    },
    {
      id: "activity-1",
      type: "offer.delivered",
      occurredAt: "2026-07-20T22:00:00.000Z",
      message: "Standby delivered an appointment offer to Alex via Telegram.",
      customerId: "alex",
      customerName: "Alex",
    },
  ],
  context: {
    customer: {
      id: "alex",
      name: "Alex",
      contactPreference: "telegram",
      identitySummary: "Telegram linked",
    },
    appointment: {
      barberName: "Jeremy",
      serviceName: "Signature haircut",
      startAt: "2026-07-20T22:00:00.000Z",
      endAt: "2026-07-20T23:00:00.000Z",
      status: "delivered",
    },
    automation: {
      state: "Waiting for Alex",
      offerStatus: "delivered",
      expiresAt: "2026-07-20T22:04:00.000Z",
      refillStatus: "awaiting_offer",
      moveDepth: 1,
    },
    privateNote: {
      id: "note-alex",
      text: "Usually available after work.",
      author: "operator",
      createdAt: "2026-07-18T16:00:00.000Z",
    },
  },
};

const voiceDetail: ConversationDetail = {
  conversation: conversations[1]!,
  events: [
    {
      id: "voice-1",
      kind: "transcript",
      direction: "outbound",
      speaker: "agent",
      text: "Hi Sarah, an earlier appointment opened up.",
      occurredAt: "2026-07-20T21:01:00.000Z",
      metadata: { timeInCallSeconds: 0 },
    },
    {
      id: "voice-2",
      kind: "transcript",
      direction: "inbound",
      speaker: "customer",
      text: "Yes, move me to five.",
      occurredAt: "2026-07-20T21:02:00.000Z",
      metadata: { timeInCallSeconds: 4 },
    },
  ],
  activity: [],
  context: {
    customer: {
      id: "sarah",
      name: "Sarah",
      contactPreference: "voice",
      identitySummary: "••• ••• 0101",
    },
    automation: { state: "Monitoring" },
  },
};

const waitlist: OperatorWaitlistEntry[] = [{
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
}];

const activity: ActivityItem[] = [{
  id: "activity-1",
  type: "appointment.cancelled",
  occurredAt: "2026-07-20T21:00:00.000Z",
  message: "Josh's appointment was cancelled; Standby opened refill work.",
  customerId: "josh",
  customerName: "Josh",
}];

function api(overrides: Partial<StandbyApi> = {}): StandbyApi {
  return {
    getCalendar: vi.fn(async () => { throw new Error("unused"); }),
    getCalendarRange: vi.fn(async () => { throw new Error("unused"); }),
    getAvailability: vi.fn(async () => { throw new Error("unused"); }),
    getSettings: vi.fn(async () => settings),
    patchSettings: vi.fn(async (patch) => ({ ...settings, ...patch })),
    resetDemo: vi.fn(async () => ({ status: "reset", demoDate: "2026-07-20" })),
    getCustomers: vi.fn(async () => []),
    getCustomer: vi.fn(async () => { throw new Error("unused"); }),
    patchCustomer: vi.fn(async () => { throw new Error("unused"); }),
    addCustomerNote: vi.fn(async () => { throw new Error("unused"); }),
    createCustomer: vi.fn(async () => ({ id: "new-customer", name: "New Customer", contactPreference: "telegram" as const, identitySummary: "No linked channel", activeWaitlistCount: 0, bookingState: "not_eligible" as const, bookingStateLabel: "Not eligible", visitCount: 0, outreachEligible: false, matchReason: "New customer." })),
    getConversations: vi.fn(async () => conversations),
    getConversation: vi.fn(async (id) => id === "conversation-sarah" ? voiceDetail : detail),
    getWaitlist: vi.fn(async () => waitlist),
    patchWaitlist: vi.fn(async (id, patch) => ({ ...waitlist[0]!, id, ...patch } as OperatorWaitlistEntry)),
    getActivity: vi.fn(async () => activity),
    bookAppointment: vi.fn(async () => { throw new Error("unused"); }),
    rescheduleAppointment: vi.fn(async () => { throw new Error("unused"); }),
    cancelAppointment: vi.fn(async () => { throw new Error("unused"); }),
    cancelRefillJob: vi.fn(async () => { throw new Error("unused"); }),
    ...overrides,
  };
}

afterEach(cleanup);

describe("AgentPage", () => {
  it("renders real conversations in the locked list, ledger, and context structure", async () => {
    const { container } = render(<AgentPage api={api()} refreshKey={0} />);

    expect(await screen.findByRole("heading", { name: "Conversations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Context" })).toBeInTheDocument();
    expect(screen.getByText("Telegram · Outbound")).toBeInTheDocument();
    expect(screen.getByText("Phone call · Outbound")).toBeInTheDocument();
    expect(screen.getByText(/Exception/)).toBeInTheDocument();
    expect(container.querySelector(".rounded-full.bg-standby")).toBeNull();
    expect(container.querySelector(".rounded-full.bg-amber")).toBeNull();
    expect(screen.getByRole("region", { name: "Agent inbox" })).toHaveClass("rounded-[14px]");

    expect(await screen.findByText("A 6 PM chair opened with Jeremy.")).toBeInTheDocument();
    const question = screen.getByText("Is the haircut still forty-five dollars?");
    const answer = screen.getByText("Yes — the signature haircut is $45.");
    expect(question.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ledgerAction = screen.getByText("Standby checked Jeremy's live availability.");
    expect(ledgerAction).toHaveClass("justify-self-center", "text-center");
    expect(ledgerAction.parentElement).toHaveClass("grid-cols-[minmax(0,1fr)_auto]", "items-center");
    expect(screen.queryByText(/never render this JSON/i)).not.toBeInTheDocument();

    const context = screen.getByRole("complementary", { name: "Context" });
    expect(context).toHaveClass("lg:col-start-2", "xl:col-start-auto");
    for (const label of ["Customer", "Appointment", "Automation", "Appointment activity", "Private note"]) {
      expect(within(context).getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(within(context).getByText("Waiting for Alex")).toBeInTheDocument();
    expect(within(context).getByText("Alex's appointment was cancelled; Standby opened refill work.")).toBeInTheDocument();
    expect(within(context).getByText("Usually available after work.")).toBeInTheDocument();
  });

  it("filters Telegram and phone conversations and renders persisted call transcripts", async () => {
    const user = userEvent.setup();
    render(<AgentPage api={api()} refreshKey={0} />);

    await screen.findByRole("heading", { name: "Conversations" });
    await user.click(screen.getByRole("button", { name: "Calls 1" }));
    expect(screen.getAllByText("Sarah").length).toBeGreaterThan(0);
    expect(await screen.findByText("Hi Sarah, an earlier appointment opened up.")).toBeInTheDocument();
    expect(screen.getAllByText("Yes, move me to five.").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/call transcript/i)).toHaveLength(2);
    expect(screen.getByText("call 0:04")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Telegram 1" }));
    expect(screen.getAllByText("Alex").length).toBeGreaterThan(0);
    expect(await screen.findByText("A 6 PM chair opened with Jeremy.")).toBeInTheDocument();
  });

  it("shows an honest empty state when no provider interactions exist", async () => {
    render(<AgentPage api={api({ getConversations: vi.fn(async () => []) })} refreshKey={0} />);

    expect(await screen.findByText("Real Telegram messages and voice calls will appear here as they happen.")).toBeInTheDocument();
    expect(screen.queryByText("Sample conversation")).not.toBeInTheDocument();
  });

  it("supervises waitlist state and private notes without exposing provider controls", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<AgentPage api={client} refreshKey={0} />);

    await user.click(screen.getByRole("button", { name: "Waitlist" }));
    const panel = await screen.findByRole("region", { name: "Open waitlist" });
    expect(panel).toHaveClass("rounded-[14px]");
    expect(within(panel).getByText("Alex")).toBeInTheDocument();
    expect(within(panel).getByText("Signature haircut · Jeremy")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Pause Alex" }));
    await waitFor(() => expect(client.patchWaitlist).toHaveBeenCalledWith(
      "waitlist-alex",
      { status: "paused" },
    ));

    await user.click(within(panel).getByRole("button", { name: "Add note for Alex" }));
    await user.type(within(panel).getByLabelText("Private note for Alex"), "  Call after 4 PM.  ");
    await user.click(within(panel).getByRole("button", { name: "Save note for Alex" }));
    await waitFor(() => expect(client.patchWaitlist).toHaveBeenCalledWith(
      "waitlist-alex",
      { operatorNote: "Call after 4 PM." },
    ));

    await user.click(within(panel).getByRole("button", { name: "Remove Alex" }));
    await user.click(within(panel).getByRole("button", { name: "Confirm remove Alex" }));
    await waitFor(() => expect(client.patchWaitlist).toHaveBeenCalledWith(
      "waitlist-alex",
      { status: "withdrawn" },
    ));

    await user.click(screen.getByRole("button", { name: "Activity" }));
    const activityPanel = screen.getByRole("region", { name: "Scheduling activity" });
    expect(activityPanel).toHaveClass("rounded-[14px]");
    expect(within(activityPanel).getByText("Josh's appointment was cancelled; Standby opened refill work.")).toBeInTheDocument();
    expect(screen.queryByText(/API key|raw webhook|voice laboratory/i)).not.toBeInTheDocument();
  });
});
