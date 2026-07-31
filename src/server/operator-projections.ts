import { DateTime } from "luxon";

import type { StandbyState } from "../domain/store.js";
import type { Appointment, CalendarEvent, ConversationEvent, WaitlistEntry } from "../domain/types.js";

function customerName(state: StandbyState, customerId: string): string {
  return state.customers.find((customer) => customer.id === customerId)?.name ?? "Unknown customer";
}

function barberName(state: StandbyState, barberId: string | undefined): string {
  if (barberId === undefined) return "Any barber";
  return state.barbers.find((barber) => barber.id === barberId)?.name ?? "Unknown barber";
}

function serviceName(state: StandbyState, serviceId: string): string {
  return state.services.find((service) => service.id === serviceId)?.name ?? "Unknown service";
}

function maskPhone(phone: string | undefined): string {
  if (phone === undefined) return "Not linked";
  const lastFour = phone.replace(/\D/g, "").slice(-4);
  return `••• ••• ${lastFour}`;
}

function projectAppointment(state: StandbyState, appointment: Appointment) {
  return {
    id: appointment.id,
    customerId: appointment.customerId,
    customerName: customerName(state, appointment.customerId),
    barberId: appointment.barberId,
    barberName: barberName(state, appointment.barberId),
    serviceId: appointment.serviceId,
    serviceName: serviceName(state, appointment.serviceId),
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    discountPercent: appointment.discountPercent,
    version: appointment.version,
    history: appointment.history.map((event) => ({
      type: event.type,
      actor: event.actor,
      consent: event.consent,
      createdAt: event.createdAt,
      ...(event.fromStartAt === undefined ? {} : { fromStartAt: event.fromStartAt }),
      ...(event.toStartAt === undefined ? {} : { toStartAt: event.toStartAt }),
      ...(event.note === undefined ? {} : { note: event.note }),
    })),
  };
}

function projectWaitlistEntry(state: StandbyState, entry: WaitlistEntry) {
  const customer = state.customers.find((candidate) => candidate.id === entry.customerId);
  const offer = state.offers
    .filter((candidate) => candidate.waitlistEntryId === entry.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return {
    id: entry.id,
    customerId: entry.customerId,
    customerName: customer?.name ?? "Unknown customer",
    serviceId: entry.serviceId,
    serviceName: serviceName(state, entry.serviceId),
    ...(entry.barberId === undefined ? {} : { barberId: entry.barberId }),
    barberName: barberName(state, entry.barberId),
    date: entry.date,
    earliestStart: entry.earliestStart,
    latestStart: entry.latestStart,
    status: entry.status,
    channel: customer?.contactPreference ?? "telegram",
    outreachState: offer?.status ?? (entry.status === "paused" ? "paused" : "not_contacted"),
    ...(entry.operatorNote === undefined ? {} : { operatorNote: entry.operatorNote }),
    createdAt: entry.createdAt,
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
  };
}

function projectionReferenceTime(state: StandbyState): DateTime {
  const lastReset = state.events
    .filter((event) => event.type === "demo.reset")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  const reference = DateTime.fromISO(lastReset?.occurredAt ?? "").toUTC();
  return reference.isValid ? reference : DateTime.utc();
}

function mostFrequentName(ids: string[], resolveName: (id: string) => string): string | undefined {
  if (ids.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const mostFrequentId = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  return mostFrequentId === undefined ? undefined : resolveName(mostFrequentId);
}

function waitlistTime(entry: WaitlistEntry, value: string, timezone: string): DateTime {
  return value.includes("T")
    ? DateTime.fromISO(value).setZone(timezone)
    : DateTime.fromISO(`${entry.date}T${value}`, { zone: timezone });
}

function summarizeWaitlist(state: StandbyState, entry: WaitlistEntry): string {
  const timezone = state.settings.timezone;
  const earliest = waitlistTime(entry, entry.earliestStart, timezone);
  const latest = waitlistTime(entry, entry.latestStart, timezone);
  const dateLabel = earliest.isValid ? earliest.toFormat("ccc, LLL d") : entry.date;
  const timeLabel = earliest.isValid && latest.isValid
    ? `${earliest.toFormat("h:mm a")}–${latest.toFormat("h:mm a")}`
    : `${entry.earliestStart}–${entry.latestStart}`;
  return `${serviceName(state, entry.serviceId)} · ${barberName(state, entry.barberId)} · ${dateLabel}, ${timeLabel}`;
}

function deriveCustomerIntelligence(state: StandbyState, customerId: string) {
  const customer = state.customers.find((candidate) => candidate.id === customerId)!;
  const referenceTime = projectionReferenceTime(state);
  const confirmed = state.appointments.filter((appointment) => (
    appointment.customerId === customerId && appointment.status === "confirmed"
  ));
  const upcoming = confirmed
    .filter((appointment) => DateTime.fromISO(appointment.startAt).toUTC() >= referenceTime)
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const past = confirmed
    .filter((appointment) => DateTime.fromISO(appointment.startAt).toUTC() < referenceTime)
    .sort((left, right) => right.startAt.localeCompare(left.startAt));
  const activeWaitlist = state.waitlist
    .filter((entry) => (
      entry.customerId === customerId && ["active", "paused", "offered"].includes(entry.status)
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const nextAppointment = upcoming[0];
  const currentWaitlist = activeWaitlist[0];
  const replacementOffersEnabled = customer.replacementOffersEnabled !== false;
  const bookingState = nextAppointment !== undefined
    ? "booked" as const
    : currentWaitlist !== undefined
      ? "waitlisted" as const
      : replacementOffersEnabled && customer.pastCustomerOptIn
        ? "outreach_ready" as const
        : "not_eligible" as const;
  const bookingStateLabel = bookingState === "booked"
    ? "Booked"
    : bookingState === "waitlisted"
      ? "Waitlisted"
      : bookingState === "outreach_ready"
        ? "Ready to contact"
        : "Not eligible";
  const usualServiceName = mostFrequentName(past.map((appointment) => appointment.serviceId), (id) => serviceName(state, id));
  const usualBarberName = mostFrequentName(past.map((appointment) => appointment.barberId), (id) => barberName(state, id));
  const matchReason = bookingState === "booked"
    ? `Already confirmed for ${serviceName(state, nextAppointment!.serviceId)} with ${barberName(state, nextAppointment!.barberId)}.`
    : bookingState === "waitlisted"
      ? `Actively waiting for ${serviceName(state, currentWaitlist!.serviceId)} in a preferred time window.`
      : bookingState === "outreach_ready" && past.length > 0
        ? `Returning ${usualServiceName ?? "service"} customer · ${past.length} ${past.length === 1 ? "visit" : "visits"} · outreach allowed.`
        : bookingState === "outreach_ready"
          ? "Known customer with no upcoming booking · outreach allowed."
          : replacementOffersEnabled
            ? "No upcoming booking · automated outreach is off."
            : "Replacement offers are turned off for this customer.";

  return {
    bookingState,
    bookingStateLabel,
    activeWaitlistCount: activeWaitlist.length,
    visitCount: past.length,
    outreachEligible: bookingState === "outreach_ready",
    matchReason,
    ...(nextAppointment === undefined ? {} : {
      nextAppointmentAt: nextAppointment.startAt,
      nextBarberName: barberName(state, nextAppointment.barberId),
      nextServiceName: serviceName(state, nextAppointment.serviceId),
    }),
    ...(currentWaitlist === undefined ? {} : {
      waitlistRequestSummary: summarizeWaitlist(state, currentWaitlist),
    }),
    ...(past[0] === undefined ? {} : { lastVisitAt: past[0].startAt }),
    ...(usualServiceName === undefined ? {} : { usualServiceName }),
    ...(usualBarberName === undefined ? {} : { usualBarberName }),
  };
}

export function projectCustomerList(state: StandbyState, query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return state.customers
    .filter((customer) => customer.name.toLocaleLowerCase().includes(normalizedQuery))
    .map((customer) => {
      const linkedPreferredChannel = customer.contactPreference === "telegram"
        ? customer.telegramChatId !== undefined
        : customer.phone !== undefined;
      return {
        id: customer.id,
        name: customer.name,
        contactPreference: customer.contactPreference,
        identitySummary: linkedPreferredChannel
          ? customer.contactPreference === "telegram" ? "Telegram linked" : "Phone linked"
          : "No linked channel",
        ...deriveCustomerIntelligence(state, customer.id),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function projectCustomerDetail(state: StandbyState, customerId: string) {
  const customer = state.customers.find((candidate) => candidate.id === customerId);
  if (customer === undefined) return undefined;
  return {
    id: customer.id,
    name: customer.name,
    identities: {
      telegram: customer.telegramChatId === undefined ? "Not linked" : "Linked account",
      phone: maskPhone(customer.phone),
    },
    preferences: {
      contactPreference: customer.contactPreference,
      replacementOffersEnabled: customer.replacementOffersEnabled !== false,
      earlierMoveConsent: customer.earlierMoveConsent,
      flexibleBarberPreference: customer.flexibleBarberPreference,
      pastCustomerOptIn: customer.pastCustomerOptIn,
    },
    relationship: deriveCustomerIntelligence(state, customer.id),
    appointments: state.appointments
      .filter((appointment) => appointment.customerId === customer.id)
      .map((appointment) => projectAppointment(state, appointment))
      .sort((left, right) => right.startAt.localeCompare(left.startAt)),
    waitlist: state.waitlist
      .filter((entry) => entry.customerId === customer.id)
      .map((entry) => projectWaitlistEntry(state, entry))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    notes: state.customerNotes
      .filter((note) => note.customerId === customer.id)
      .map((note) => ({
        id: note.id,
        text: note.text,
        author: note.author,
        createdAt: note.createdAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export function projectConversationList(state: StandbyState) {
  return state.conversations
    .map((conversation) => ({
      id: conversation.id,
      customerId: conversation.customerId,
      customerName: customerName(state, conversation.customerId),
      channel: conversation.channel,
      direction: conversation.direction,
      state: conversation.state,
      preview: conversation.preview,
      updatedAt: conversation.updatedAt,
      hasException: conversation.state === "failed" || state.conversationEvents.some((event) => (
        event.conversationId === conversation.id && event.kind === "error"
      )),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function projectConversationEvent(event: ConversationEvent) {
  return {
    id: event.id,
    kind: event.kind,
    ...(event.direction === undefined ? {} : { direction: event.direction }),
    speaker: event.speaker,
    text: event.text,
    ...(event.deliveryState === undefined ? {} : { deliveryState: event.deliveryState }),
    ...(event.appointmentId === undefined ? {} : { appointmentId: event.appointmentId }),
    ...(event.refillJobId === undefined ? {} : { refillJobId: event.refillJobId }),
    ...(event.offerId === undefined ? {} : { offerId: event.offerId }),
    occurredAt: event.occurredAt,
    ...(event.metadata === undefined ? {} : { metadata: { ...event.metadata } }),
  };
}

function eventCustomerId(state: StandbyState, event: CalendarEvent): string | undefined {
  const direct = event.data?.customerId;
  if (typeof direct === "string") return direct;
  const appointment = state.appointments.find((candidate) => candidate.id === event.aggregateId);
  if (appointment !== undefined) return appointment.customerId;
  const offer = state.offers.find((candidate) => candidate.id === event.aggregateId);
  return offer?.customerId;
}

function eventMessage(state: StandbyState, event: CalendarEvent): string {
  const appointment = state.appointments.find((candidate) => candidate.id === event.aggregateId);
  const offer = state.offers.find((candidate) => candidate.id === event.aggregateId);
  const name = eventCustomerId(state, event) === undefined
    ? "the customer"
    : customerName(state, eventCustomerId(state, event)!);
  switch (event.type) {
    case "appointment.booked": return `${name}'s appointment was booked.`;
    case "appointment.cancelled": return `${name}'s appointment was cancelled; Standby opened refill work.`;
    case "appointment.rescheduled": return `${name}'s appointment was rescheduled.`;
    case "appointment.moved_earlier": return `${name} accepted an earlier appointment.`;
    case "offer.created": return `Standby prepared an appointment offer for ${name}.`;
    case "offer.delivered": {
      const channel = offer?.channel ?? event.data?.channel;
      return `Standby delivered an appointment offer to ${name} via ${channel === "telegram" ? "Telegram" : "voice"}.`;
    }
    case "offer.declined": return `${name} declined the appointment offer.`;
    case "offer.expired": return `${name}'s appointment offer expired.`;
    case "settings.updated": return "Automation settings were updated.";
    case "demo.reset": return "The demo week was reset.";
    case "customer.updated": return `${name}'s preferences were updated.`;
    case "customer.note_added": return `A private note was added for ${name}.`;
    case "waitlist.updated": return `${name}'s waitlist entry was updated.`;
    default: return appointment === undefined ? "Standby updated scheduling state." : `${name}'s appointment was updated.`;
  }
}

export function projectActivity(state: StandbyState) {
  return state.events
    .map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      message: eventMessage(state, event),
      ...(eventCustomerId(state, event) === undefined ? {} : {
        customerId: eventCustomerId(state, event),
        customerName: customerName(state, eventCustomerId(state, event)!),
      }),
    }))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function projectConversationDetail(state: StandbyState, conversationId: string) {
  const conversation = state.conversations.find((candidate) => candidate.id === conversationId);
  if (conversation === undefined) return undefined;
  const summary = projectConversationList(state).find((candidate) => candidate.id === conversation.id)!;
  const offer = conversation.offerId === undefined
    ? undefined
    : state.offers.find((candidate) => candidate.id === conversation.offerId);
  const refill = offer === undefined
    ? undefined
    : state.refillJobs.find((candidate) => candidate.id === offer.jobId);
  const linkedAppointment = conversation.appointmentId === undefined
    ? undefined
    : state.appointments.find((candidate) => candidate.id === conversation.appointmentId);
  const contextAppointment = offer !== undefined && refill !== undefined
    ? {
        barberName: barberName(state, refill.barberId),
        serviceName: serviceName(state, refill.serviceId),
        startAt: offer.proposedStartAt,
        endAt: offer.proposedEndAt,
        status: offer.status,
      }
    : linkedAppointment === undefined
      ? undefined
      : projectAppointment(state, linkedAppointment);
  const customer = state.customers.find((candidate) => candidate.id === conversation.customerId)!;
  const latestNote = state.customerNotes
    .filter((note) => note.customerId === customer.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const automationState = refill?.status === "awaiting_offer"
    ? `Waiting for ${customer.name}`
    : refill?.status === "pending"
      ? "Finding a match"
      : refill?.status === "completed"
        ? "Opening filled"
        : conversation.state === "failed"
          ? "Needs review"
          : "Monitoring";
  return {
    conversation: summary,
    events: state.conversationEvents
      .filter((event) => event.conversationId === conversation.id)
      .map(projectConversationEvent)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    activity: projectActivity(state).filter((event) => event.customerId === customer.id),
    context: {
      customer: {
        id: customer.id,
        name: customer.name,
        contactPreference: customer.contactPreference,
        identitySummary: customer.contactPreference === "telegram"
          ? customer.telegramChatId === undefined ? "Telegram not linked" : "Telegram linked"
          : maskPhone(customer.phone),
      },
      ...(contextAppointment === undefined ? {} : { appointment: contextAppointment }),
      automation: {
        state: automationState,
        ...(offer === undefined ? {} : { offerStatus: offer.status, expiresAt: offer.expiresAt }),
        ...(refill === undefined ? {} : { refillStatus: refill.status, moveDepth: refill.moveDepth }),
      },
      ...(latestNote === undefined ? {} : {
        privateNote: { id: latestNote.id, text: latestNote.text, createdAt: latestNote.createdAt },
      }),
    },
  };
}

export function projectWaitlist(state: StandbyState) {
  return state.waitlist
    .map((entry) => projectWaitlistEntry(state, entry))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export { projectAppointment };
