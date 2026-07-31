import { DateTime } from "luxon";

import { SHOP_CLOSE_TIME, SHOP_OPEN_TIME } from "../domain/shop-hours.js";
import type { StandbyState } from "../domain/store.js";
import type {
  Appointment,
  AppointmentHistoryEvent,
  Barber,
  Conversation,
  ConversationEvent,
  Customer,
  OutreachOffer,
  RefillJob,
  SchedulingSettings,
  Service,
} from "../domain/types.js";

interface CustomerContactOverride {
  telegramChatId?: string;
  phone?: string;
}

interface CreateDemoStateOptions {
  now: string;
  timezone: string;
  contactOverrides?: Record<string, CustomerContactOverride>;
}

export function getDemoDate(now: string, timezone: string): string {
  let date = DateTime.fromISO(now).setZone(timezone).startOf("day");
  if (!date.isValid) throw new Error("Cannot seed Standby from an invalid date.");
  while (date.weekday > 5) date = date.plus({ days: 1 });
  return date.toISODate()!;
}

function at(date: string, hour: number, minute: number, timezone: string): string {
  return DateTime.fromObject(
    {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      day: Number(date.slice(8, 10)),
      hour,
      minute,
    },
    { zone: timezone },
  ).toUTC().toISO()!;
}

function standardHours(): Barber["weeklyHours"] {
  return {
    1: [{ start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME }],
    2: [{ start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME }],
    3: [{ start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME }],
    4: [{ start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME }],
    5: [{ start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME }],
  };
}

const additionalCustomerSeeds = [
  ["olivia", "Olivia"],
  ["liam", "Liam"],
  ["emma", "Emma"],
  ["noah", "Noah"],
  ["ava", "Ava"],
  ["ethan", "Ethan"],
  ["mia", "Mia"],
  ["lucas", "Lucas"],
  ["sophia", "Sophia"],
  ["mason", "Mason"],
  ["isabella", "Isabella"],
  ["logan", "Logan"],
  ["amelia", "Amelia"],
  ["benjamin", "Benjamin"],
  ["harper", "Harper"],
  ["jacob", "Jacob"],
  ["evelyn", "Evelyn"],
  ["daniel", "Daniel"],
  ["charlotte", "Charlotte"],
  ["henry", "Henry"],
  ["luna", "Luna"],
  ["jackson", "Jackson"],
  ["camila", "Camila"],
  ["sebastian", "Sebastian"],
  ["sofia", "Sofia"],
  ["mateo", "Mateo"],
  ["layla", "Layla"],
  ["owen", "Owen"],
  ["zoe", "Zoe"],
  ["leo", "Leo"],
  ["aiden", "Aiden"],
  ["chloe", "Chloe"],
  ["gabriel", "Gabriel"],
  ["grace", "Grace"],
  ["isaac", "Isaac"],
  ["hannah", "Hannah"],
  ["julian", "Julian"],
  ["nora", "Nora"],
  ["samuel", "Samuel"],
  ["victoria", "Victoria"],
  ["wyatt", "Wyatt"],
  ["aria", "Aria"],
  ["caleb", "Caleb"],
  ["ruby", "Ruby"],
  ["nathan", "Nathan"],
  ["stella", "Stella"],
  ["adrian", "Adrian"],
  ["claire", "Claire"],
] as const;

const currentBookingCustomerIds = new Set([
  "olivia", "liam", "emma", "noah", "ava", "ethan", "mia", "lucas", "sophia", "mason",
  "isabella", "logan", "amelia", "benjamin", "harper", "jacob", "evelyn", "daniel", "charlotte", "henry",
]);

function appointmentsOverlap(startAt: string, endAt: string, appointment: Appointment): boolean {
  return appointment.status === "confirmed"
    && DateTime.fromISO(startAt).toMillis() < DateTime.fromISO(appointment.endAt).toMillis()
    && DateTime.fromISO(endAt).toMillis() > DateTime.fromISO(appointment.startAt).toMillis();
}

function fillBusyWeek(input: {
  appointments: Appointment[];
  customers: Customer[];
  barbers: Barber[];
  services: Service[];
  demoDate: string;
  timezone: string;
  now: string;
}): void {
  const denseCustomers = input.customers.filter((customer) => (
    currentBookingCustomerIds.has(customer.id)
  ));
  const serviceById = new Map(input.services.map((service) => [service.id, service]));
  const preferredStarts = [
    10 * 60,
    11 * 60,
    13 * 60,
    14 * 60,
    16 * 60,
    17 * 60,
    19 * 60,
    12 * 60,
    15 * 60,
    18 * 60,
    10 * 60 + 30,
    11 * 60 + 30,
    12 * 60 + 30,
    13 * 60 + 30,
    14 * 60 + 30,
    15 * 60 + 30,
    16 * 60 + 30,
    17 * 60 + 30,
    18 * 60 + 30,
    19 * 60 + 30,
  ];
  let customerCursor = 0;

  const nextCustomer = (startAt: string, endAt: string): Customer => {
    for (let offset = 0; offset < denseCustomers.length; offset += 1) {
      const index = (customerCursor + offset) % denseCustomers.length;
      const customer = denseCustomers[index]!;
      const hasConflict = input.appointments.some((appointment) => (
        appointment.customerId === customer.id
        && appointmentsOverlap(startAt, endAt, appointment)
      ));
      if (!hasConflict) {
        customerCursor = (index + 1) % denseCustomers.length;
        return customer;
      }
    }
    throw new Error("The demo customer pool is too small for the generated schedule.");
  };

  for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
    const date = DateTime.fromISO(input.demoDate, { zone: input.timezone })
      .plus({ days: dayOffset })
      .toISODate()!;
    for (const barber of input.barbers) {
      const targetMinutes = barber.id === "maya"
        ? (dayOffset % 2 === 0 ? 480 : 420)
        : 450;
      let bookedMinutes = input.appointments
        .filter((appointment) => (
          appointment.barberId === barber.id
          && appointment.status === "confirmed"
          && DateTime.fromISO(appointment.startAt).setZone(input.timezone).toISODate() === date
        ))
        .reduce((total, appointment) => (
          total + DateTime.fromISO(appointment.endAt).diff(DateTime.fromISO(appointment.startAt), "minutes").minutes
        ), 0);
      const hourServices = barber.serviceIds
        .map((serviceId) => serviceById.get(serviceId))
        .filter((service): service is Service => service?.durationMinutes === 60);
      const halfHourService = barber.serviceIds
        .map((serviceId) => serviceById.get(serviceId))
        .find((service) => service?.durationMinutes === 30);
      let serviceCursor = dayOffset + input.barbers.indexOf(barber);

      for (const startMinute of preferredStarts) {
        if (bookedMinutes >= targetMinutes) break;
        if (date === input.demoDate && barber.id === "jeremy" && startMinute === 19 * 60) continue;
        const remainingMinutes = targetMinutes - bookedMinutes;
        const service = remainingMinutes >= 60
          ? hourServices[serviceCursor % hourServices.length]
          : halfHourService;
        if (service === undefined || service.durationMinutes > remainingMinutes) continue;
        const startAt = at(date, Math.floor(startMinute / 60), startMinute % 60, input.timezone);
        const endAt = DateTime.fromISO(startAt)
          .plus({ minutes: service.durationMinutes })
          .toUTC()
          .toISO()!;
        const barberConflict = input.appointments.some((appointment) => (
          appointment.barberId === barber.id
          && appointmentsOverlap(startAt, endAt, appointment)
        ));
        if (barberConflict) continue;
        const customer = nextCustomer(startAt, endAt);
        input.appointments.push(seededAppointment(
          `busy-${date}-${barber.id}-${startMinute}`,
          customer.id,
          barber.id,
          service,
          startAt,
          input.now,
        ));
        bookedMinutes += service.durationMinutes;
        serviceCursor += 1;
      }
      if (bookedMinutes !== targetMinutes) {
        throw new Error(`Could not fill ${barber.name}'s ${date} schedule to the demo target.`);
      }
    }
  }
}

function addRecurringCustomerHistory(input: {
  appointments: Appointment[];
  customers: Customer[];
  barbers: Barber[];
  services: Service[];
  demoDate: string;
  timezone: string;
}): void {
  const visitTimes = [10, 11, 13, 14, 16, 17, 18, 19];
  const serviceById = new Map(input.services.map((service) => [service.id, service]));

  input.customers.forEach((customer, customerIndex) => {
    if (customerIndex >= input.customers.length - 5) return;
    const visitCount = customerIndex % 6 === 0 ? 2 : 3 + (customerIndex % 3);
    const dayOffset = Math.floor(customerIndex / 24);
    const slotWithinDay = customerIndex % 24;
    const barber = input.barbers[Math.floor(slotWithinDay / visitTimes.length)]!;
    const hour = visitTimes[slotWithinDay % visitTimes.length]!;
    const supportedServices = barber.serviceIds.map((serviceId) => serviceById.get(serviceId)!);
    const service = supportedServices[customerIndex % supportedServices.length]!;

    for (let visitIndex = 0; visitIndex < visitCount; visitIndex += 1) {
      const visitDate = DateTime.fromISO(input.demoDate, { zone: input.timezone })
        .minus({ weeks: visitIndex + 2 })
        .plus({ days: dayOffset })
        .toISODate()!;
      const startAt = at(visitDate, hour, 0, input.timezone);
      const bookedAt = DateTime.fromISO(startAt).minus({ days: 8 }).toUTC().toISO()!;
      const appointment = seededAppointment(
        `history-${customer.id}-${visitIndex + 1}`,
        customer.id,
        barber.id,
        service,
        startAt,
        bookedAt,
      );
      input.appointments.push(appointment);
    }
  });
}

function seededAppointment(
  id: string,
  customerId: string,
  barberId: string,
  service: Service,
  startAt: string,
  now: string,
  status: Appointment["status"] = "confirmed",
): Appointment {
  const history: AppointmentHistoryEvent = {
    type: status === "confirmed" ? "booked" : "cancelled",
    actor: "demo-reset",
    consent: "admin_reset",
    createdAt: now,
    ...(status === "confirmed" ? { toStartAt: startAt } : { fromStartAt: startAt }),
  };
  return {
    id,
    customerId,
    barberId,
    serviceId: service.id,
    startAt,
    endAt: DateTime.fromISO(startAt).plus({ minutes: service.durationMinutes }).toUTC().toISO()!,
    status,
    discountPercent: 0,
    version: 1,
    history: [history],
    createdAt: now,
    updatedAt: now,
  };
}

interface AgentConversationSeed {
  appointments: Appointment[];
  refillJobs: RefillJob[];
  offers: OutreachOffer[];
  conversations: Conversation[];
  conversationEvents: ConversationEvent[];
}

function createAgentConversationSeed(input: {
  now: string;
  demoDate: string;
  timezone: string;
  haircut: Service;
}): AgentConversationSeed {
  const priorMonday = DateTime.fromISO(input.demoDate, { zone: input.timezone })
    .minus({ days: 7 })
    .toISODate()!;
  const priorTuesday = DateTime.fromISO(priorMonday, { zone: input.timezone }).plus({ days: 1 }).toISODate()!;
  const priorWednesday = DateTime.fromISO(priorMonday, { zone: input.timezone }).plus({ days: 2 }).toISODate()!;
  const stamp = (date: string, hour: number, minute: number): string => at(date, hour, minute, input.timezone);
  const plusMinutes = (value: string, minutes: number): string => DateTime
    .fromISO(value)
    .plus({ minutes })
    .toUTC()
    .toISO()!;

  const liamStart = stamp(priorMonday, 17, 0);
  const avaOriginalStart = stamp(priorMonday, 18, 0);
  const mateoStart = avaOriginalStart;
  const zoeStart = stamp(priorTuesday, 14, 0);
  const benjaminOriginalStart = stamp(priorWednesday, 17, 0);
  const benjaminStart = stamp(priorWednesday, 16, 0);

  const liamAppointment = seededAppointment(
    "demo-liam-cancelled-appt",
    "liam",
    "jeremy",
    input.haircut,
    liamStart,
    input.now,
    "cancelled",
  );
  const avaAppointment = seededAppointment(
    "demo-ava-moved-appt",
    "ava",
    "jeremy",
    input.haircut,
    liamStart,
    input.now,
  );
  avaAppointment.history = [
    {
      type: "booked",
      actor: "demo-reset",
      consent: "admin_reset",
      createdAt: stamp(priorMonday, 9, 0),
      toStartAt: avaOriginalStart,
    },
    {
      type: "moved_earlier",
      actor: "elevenlabs",
      consent: "explicit",
      createdAt: stamp(priorMonday, 13, 8),
      fromStartAt: avaOriginalStart,
      toStartAt: liamStart,
      offerId: "demo-offer-ava",
    },
  ];
  const mateoAppointment = seededAppointment(
    "demo-mateo-refill-appt",
    "mateo",
    "jeremy",
    input.haircut,
    mateoStart,
    input.now,
  );
  mateoAppointment.history = [{
    type: "booked",
    actor: "telegram",
    consent: "explicit",
    createdAt: stamp(priorMonday, 13, 16),
    toStartAt: mateoStart,
    offerId: "demo-offer-mateo",
  }];
  const zoeAppointment = seededAppointment(
    "demo-zoe-booked-appt",
    "zoe",
    "maya",
    input.haircut,
    zoeStart,
    input.now,
  );
  zoeAppointment.history = [{
    type: "booked",
    actor: "telegram",
    consent: "explicit",
    createdAt: stamp(priorMonday, 15, 5),
    toStartAt: zoeStart,
  }];
  const benjaminAppointment = seededAppointment(
    "demo-benjamin-moved-appt",
    "benjamin",
    "devon",
    input.haircut,
    benjaminStart,
    input.now,
  );
  benjaminAppointment.history = [
    {
      type: "booked",
      actor: "demo-reset",
      consent: "admin_reset",
      createdAt: stamp(priorMonday, 9, 15),
      toStartAt: benjaminOriginalStart,
    },
    {
      type: "rescheduled",
      actor: "elevenlabs",
      consent: "explicit",
      createdAt: stamp(priorTuesday, 10, 5),
      fromStartAt: benjaminOriginalStart,
      toStartAt: benjaminStart,
    },
  ];

  const avaOfferTime = stamp(priorMonday, 13, 5);
  const mateoOfferTime = stamp(priorMonday, 13, 13);
  const refillJobs: RefillJob[] = [
    {
      id: "demo-job-liam-opening",
      sourceAppointmentId: liamAppointment.id,
      barberId: "jeremy",
      serviceId: input.haircut.id,
      slotStartAt: liamStart,
      slotEndAt: plusMinutes(liamStart, input.haircut.durationMinutes),
      status: "completed",
      moveDepth: 0,
      attemptedCustomerIds: ["ava"],
      currentOfferId: "demo-offer-ava",
      timeline: [
        { type: "opening_created", at: stamp(priorMonday, 13, 2), message: "Liam cancelled. Standby started looking for the best match." },
        { type: "offer_created", at: avaOfferTime, message: "Standby prepared an earlier-slot offer for Ava.", customerId: "ava", offerId: "demo-offer-ava" },
        { type: "offer_delivered", at: plusMinutes(avaOfferTime, 1), message: "Standby reached Ava by voice.", customerId: "ava", offerId: "demo-offer-ava" },
        { type: "appointment_moved", at: plusMinutes(avaOfferTime, 3), message: "Ava accepted and moved into the 5 PM opening.", customerId: "ava", offerId: "demo-offer-ava" },
      ],
      version: 4,
      createdAt: stamp(priorMonday, 13, 2),
      updatedAt: plusMinutes(avaOfferTime, 3),
    },
    {
      id: "demo-job-ava-opening",
      sourceAppointmentId: avaAppointment.id,
      barberId: "jeremy",
      serviceId: input.haircut.id,
      slotStartAt: avaOriginalStart,
      slotEndAt: plusMinutes(avaOriginalStart, input.haircut.durationMinutes),
      status: "completed",
      moveDepth: 1,
      attemptedCustomerIds: ["mateo"],
      currentOfferId: "demo-offer-mateo",
      timeline: [
        { type: "opening_created", at: plusMinutes(avaOfferTime, 3), message: "Ava's move opened the 6 PM appointment." },
        { type: "offer_created", at: mateoOfferTime, message: "Standby prepared the new opening for Mateo.", customerId: "mateo", offerId: "demo-offer-mateo" },
        { type: "offer_delivered", at: plusMinutes(mateoOfferTime, 1), message: "Standby reached Mateo on Telegram.", customerId: "mateo", offerId: "demo-offer-mateo" },
        { type: "opening_filled", at: plusMinutes(mateoOfferTime, 3), message: "Mateo accepted and filled the 6 PM opening.", customerId: "mateo", offerId: "demo-offer-mateo" },
      ],
      version: 4,
      createdAt: plusMinutes(avaOfferTime, 3),
      updatedAt: plusMinutes(mateoOfferTime, 3),
    },
  ];
  const offers: OutreachOffer[] = [
    {
      id: "demo-offer-ava",
      jobId: "demo-job-liam-opening",
      customerId: "ava",
      candidateKind: "move_earlier",
      channel: "voice",
      status: "accepted",
      proposedStartAt: liamStart,
      proposedEndAt: plusMinutes(liamStart, input.haircut.durationMinutes),
      originalAppointmentId: avaAppointment.id,
      originalStartAt: avaOriginalStart,
      discountPercent: 0,
      expiresAt: plusMinutes(avaOfferTime, 15),
      providerMessageId: "demo-voice-ava",
      deliveryAttempts: 1,
      createdAt: avaOfferTime,
      updatedAt: plusMinutes(avaOfferTime, 3),
    },
    {
      id: "demo-offer-mateo",
      jobId: "demo-job-ava-opening",
      customerId: "mateo",
      candidateKind: "past_customer",
      channel: "telegram",
      status: "accepted",
      proposedStartAt: mateoStart,
      proposedEndAt: plusMinutes(mateoStart, input.haircut.durationMinutes),
      discountPercent: 5,
      expiresAt: plusMinutes(mateoOfferTime, 15),
      providerMessageId: "demo-telegram-mateo",
      deliveryAttempts: 1,
      createdAt: mateoOfferTime,
      updatedAt: plusMinutes(mateoOfferTime, 3),
    },
  ];

  const conversations: Conversation[] = [
    {
      id: "conversation-demo-liam",
      customerId: "liam",
      channel: "telegram",
      direction: "inbound",
      providerConversationId: "demo-telegram-liam",
      state: "completed",
      preview: "Done — your appointment is cancelled, and Standby is filling the opening.",
      appointmentId: liamAppointment.id,
      createdAt: stamp(priorMonday, 13, 0),
      updatedAt: stamp(priorMonday, 13, 2),
    },
    {
      id: "conversation-demo-ava",
      customerId: "ava",
      channel: "voice",
      direction: "outbound",
      providerConversationId: "demo-voice-ava",
      state: "completed",
      preview: "You're all set with Jeremy at 5 PM.",
      offerId: "demo-offer-ava",
      appointmentId: avaAppointment.id,
      createdAt: avaOfferTime,
      updatedAt: plusMinutes(avaOfferTime, 3),
    },
    {
      id: "conversation-demo-mateo",
      customerId: "mateo",
      channel: "telegram",
      direction: "outbound",
      providerConversationId: "demo-telegram-mateo",
      state: "completed",
      preview: "Booked — you're confirmed with Jeremy at 6 PM.",
      offerId: "demo-offer-mateo",
      appointmentId: mateoAppointment.id,
      createdAt: mateoOfferTime,
      updatedAt: plusMinutes(mateoOfferTime, 3),
    },
    {
      id: "conversation-demo-zoe",
      customerId: "zoe",
      channel: "telegram",
      direction: "inbound",
      providerConversationId: "demo-telegram-zoe",
      state: "completed",
      preview: "Confirmed — haircut with Maya tomorrow at 2 PM.",
      appointmentId: zoeAppointment.id,
      createdAt: stamp(priorMonday, 15, 0),
      updatedAt: stamp(priorMonday, 15, 5),
    },
    {
      id: "conversation-demo-benjamin",
      customerId: "benjamin",
      channel: "voice",
      direction: "inbound",
      providerConversationId: "demo-voice-benjamin",
      state: "completed",
      preview: "Done — your haircut with Devon is now Wednesday at 4 PM.",
      appointmentId: benjaminAppointment.id,
      createdAt: stamp(priorTuesday, 10, 0),
      updatedAt: stamp(priorTuesday, 10, 5),
    },
  ];

  const conversationEvents: ConversationEvent[] = [
    { id: "demo-event-liam-1", conversationId: "conversation-demo-liam", kind: "message", direction: "inbound", speaker: "customer", text: "Hey — I need to cancel my 5 PM haircut with Jeremy.", appointmentId: liamAppointment.id, occurredAt: stamp(priorMonday, 13, 0) },
    { id: "demo-event-liam-2", conversationId: "conversation-demo-liam", kind: "message", direction: "outbound", speaker: "agent", text: "Done — your appointment is cancelled, and Standby is already working to fill the opening.", deliveryState: "delivered", appointmentId: liamAppointment.id, refillJobId: "demo-job-liam-opening", occurredAt: stamp(priorMonday, 13, 1) },
    { id: "demo-event-liam-3", conversationId: "conversation-demo-liam", kind: "action", speaker: "system", text: "Appointment cancelled · refill started", appointmentId: liamAppointment.id, refillJobId: "demo-job-liam-opening", occurredAt: stamp(priorMonday, 13, 2) },

    { id: "demo-event-ava-1", conversationId: "conversation-demo-ava", kind: "transcript", direction: "outbound", speaker: "agent", text: "Hi Ava — Jeremy has a 5 PM haircut available. Would you like to move your 6 PM appointment earlier?", offerId: "demo-offer-ava", refillJobId: "demo-job-liam-opening", occurredAt: avaOfferTime, metadata: { timeInCallSeconds: 2 } },
    { id: "demo-event-ava-2", conversationId: "conversation-demo-ava", kind: "transcript", direction: "inbound", speaker: "customer", text: "Yes, five works perfectly.", offerId: "demo-offer-ava", refillJobId: "demo-job-liam-opening", occurredAt: plusMinutes(avaOfferTime, 1), metadata: { timeInCallSeconds: 12 } },
    { id: "demo-event-ava-3", conversationId: "conversation-demo-ava", kind: "transcript", direction: "outbound", speaker: "agent", text: "You're all set. Your haircut with Jeremy is now at 5 PM.", offerId: "demo-offer-ava", refillJobId: "demo-job-liam-opening", occurredAt: plusMinutes(avaOfferTime, 2), metadata: { timeInCallSeconds: 18 } },
    { id: "demo-event-ava-4", conversationId: "conversation-demo-ava", kind: "action", speaker: "system", text: "Ava moved · 6 PM → 5 PM", appointmentId: avaAppointment.id, offerId: "demo-offer-ava", refillJobId: "demo-job-liam-opening", occurredAt: plusMinutes(avaOfferTime, 3) },

    { id: "demo-event-mateo-1", conversationId: "conversation-demo-mateo", kind: "message", direction: "outbound", speaker: "agent", text: "Hi Mateo — a 6 PM haircut with Jeremy just opened. Want me to reserve it for you?", deliveryState: "delivered", offerId: "demo-offer-mateo", refillJobId: "demo-job-ava-opening", occurredAt: mateoOfferTime },
    { id: "demo-event-mateo-2", conversationId: "conversation-demo-mateo", kind: "message", direction: "inbound", speaker: "customer", text: "Yes please, I'll take it.", offerId: "demo-offer-mateo", refillJobId: "demo-job-ava-opening", occurredAt: plusMinutes(mateoOfferTime, 1) },
    { id: "demo-event-mateo-3", conversationId: "conversation-demo-mateo", kind: "message", direction: "outbound", speaker: "agent", text: "Booked — you're confirmed with Jeremy at 6 PM.", deliveryState: "delivered", appointmentId: mateoAppointment.id, offerId: "demo-offer-mateo", refillJobId: "demo-job-ava-opening", occurredAt: plusMinutes(mateoOfferTime, 2) },
    { id: "demo-event-mateo-4", conversationId: "conversation-demo-mateo", kind: "action", speaker: "system", text: "Opening filled · Mateo confirmed at 6 PM", appointmentId: mateoAppointment.id, offerId: "demo-offer-mateo", refillJobId: "demo-job-ava-opening", occurredAt: plusMinutes(mateoOfferTime, 3) },

    { id: "demo-event-zoe-1", conversationId: "conversation-demo-zoe", kind: "message", direction: "inbound", speaker: "customer", text: "Do you have a haircut opening with Maya tomorrow afternoon?", occurredAt: stamp(priorMonday, 15, 0) },
    { id: "demo-event-zoe-2", conversationId: "conversation-demo-zoe", kind: "message", direction: "outbound", speaker: "agent", text: "Maya has 2 PM available. Would you like me to book it?", deliveryState: "delivered", occurredAt: stamp(priorMonday, 15, 2) },
    { id: "demo-event-zoe-3", conversationId: "conversation-demo-zoe", kind: "message", direction: "inbound", speaker: "customer", text: "Yes, please.", occurredAt: stamp(priorMonday, 15, 3) },
    { id: "demo-event-zoe-4", conversationId: "conversation-demo-zoe", kind: "message", direction: "outbound", speaker: "agent", text: "Confirmed — haircut with Maya tomorrow at 2 PM.", deliveryState: "delivered", appointmentId: zoeAppointment.id, occurredAt: stamp(priorMonday, 15, 4) },
    { id: "demo-event-zoe-5", conversationId: "conversation-demo-zoe", kind: "action", speaker: "system", text: "Appointment booked · Maya at 2 PM", appointmentId: zoeAppointment.id, occurredAt: stamp(priorMonday, 15, 5) },

    { id: "demo-event-benjamin-1", conversationId: "conversation-demo-benjamin", kind: "transcript", direction: "inbound", speaker: "customer", text: "Can I move my haircut with Devon from 5 PM to 4 PM on Wednesday?", occurredAt: stamp(priorTuesday, 10, 0), metadata: { timeInCallSeconds: 3 } },
    { id: "demo-event-benjamin-2", conversationId: "conversation-demo-benjamin", kind: "transcript", direction: "outbound", speaker: "agent", text: "Devon is available at 4 PM. Should I make that change?", occurredAt: stamp(priorTuesday, 10, 2), metadata: { timeInCallSeconds: 11 } },
    { id: "demo-event-benjamin-3", conversationId: "conversation-demo-benjamin", kind: "transcript", direction: "inbound", speaker: "customer", text: "Yes, please move it.", occurredAt: stamp(priorTuesday, 10, 3), metadata: { timeInCallSeconds: 16 } },
    { id: "demo-event-benjamin-4", conversationId: "conversation-demo-benjamin", kind: "transcript", direction: "outbound", speaker: "agent", text: "Done. Your haircut with Devon is now Wednesday at 4 PM.", appointmentId: benjaminAppointment.id, occurredAt: stamp(priorTuesday, 10, 4), metadata: { timeInCallSeconds: 22 } },
    { id: "demo-event-benjamin-5", conversationId: "conversation-demo-benjamin", kind: "action", speaker: "system", text: "Appointment moved · Wednesday 5 PM → 4 PM", appointmentId: benjaminAppointment.id, occurredAt: stamp(priorTuesday, 10, 5) },
  ];
  conversationEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  return {
    appointments: [
      liamAppointment,
      avaAppointment,
      mateoAppointment,
      zoeAppointment,
      benjaminAppointment,
    ],
    refillJobs,
    offers,
    conversations,
    conversationEvents,
  };
}

export function createDemoState(options: CreateDemoStateOptions): StandbyState {
  const demoDate = getDemoDate(options.now, options.timezone);
  const operationalDate = (offsetDays: number): string => DateTime
    .fromISO(demoDate, { zone: options.timezone })
    .plus({ days: offsetDays })
    .toISODate()!;
  const contacts = options.contactOverrides ?? {};
  const haircut: Service = {
    id: "haircut",
    name: "Signature haircut",
    durationMinutes: 60,
    priceCents: 4500,
  };
  const fade: Service = {
    id: "fade",
    name: "Skin fade",
    durationMinutes: 60,
    priceCents: 5200,
  };
  const beard: Service = {
    id: "beard",
    name: "Beard sculpt",
    durationMinutes: 30,
    priceCents: 2800,
  };
  const services = [haircut, fade, beard];
  const barbers: Barber[] = [
    {
      id: "jeremy",
      name: "Jeremy",
      serviceIds: services.map((service) => service.id),
      weeklyHours: standardHours(),
    },
    {
      id: "maya",
      name: "Maya",
      serviceIds: [haircut.id, fade.id],
      weeklyHours: standardHours(),
    },
    {
      id: "devon",
      name: "Devon",
      serviceIds: [haircut.id, beard.id],
      weeklyHours: standardHours(),
    },
  ];
  const customers: Customer[] = ([
    {
      id: "josh",
      name: "Josh",
      contactPreference: "telegram",
      earlierMoveConsent: false,
      flexibleBarberPreference: false,
      pastCustomerOptIn: false,
    },
    {
      id: "sarah",
      name: "Sarah",
      contactPreference: "voice",
      earlierMoveConsent: true,
      flexibleBarberPreference: false,
      pastCustomerOptIn: true,
    },
    {
      id: "alex",
      name: "Alex",
      contactPreference: "telegram",
      earlierMoveConsent: false,
      flexibleBarberPreference: false,
      pastCustomerOptIn: false,
    },
    {
      id: "nadia",
      name: "Nadia",
      contactPreference: "telegram",
      earlierMoveConsent: false,
      flexibleBarberPreference: true,
      pastCustomerOptIn: true,
    },
    {
      id: "marco",
      name: "Marco",
      contactPreference: "voice",
      earlierMoveConsent: false,
      flexibleBarberPreference: true,
      pastCustomerOptIn: true,
    },
    {
      id: "eli",
      name: "Eli",
      contactPreference: "telegram",
      earlierMoveConsent: false,
      flexibleBarberPreference: false,
      pastCustomerOptIn: false,
    },
    {
      id: "imani",
      name: "Imani",
      contactPreference: "telegram",
      earlierMoveConsent: true,
      flexibleBarberPreference: true,
      pastCustomerOptIn: false,
    },
    ...additionalCustomerSeeds.map(([id, name], index): Customer => ({
      id,
      name,
      contactPreference: index % 4 === 0 ? "voice" : "telegram",
      ...(index % 4 === 0
        ? { phone: `+1416555${String(1000 + index).padStart(4, "0")}` }
        : { telegramChatId: `900000${String(1000 + index)}` }),
      earlierMoveConsent: index % 5 === 0,
      flexibleBarberPreference: index % 3 === 0,
      pastCustomerOptIn: !currentBookingCustomerIds.has(id) && index % 4 !== 0,
    })),
  ] satisfies Customer[]).map((customer) => ({
    ...customer,
    ...contacts[customer.id],
  }));
  const appointments: Appointment[] = [
    seededAppointment("josh-appt", "josh", "jeremy", haircut, at(demoDate, 13, 0, options.timezone), options.now),
    seededAppointment("sarah-appt", "sarah", "jeremy", haircut, at(demoDate, 14, 0, options.timezone), options.now),
    seededAppointment("nadia-appt", "nadia", "maya", fade, at(demoDate, 13, 0, options.timezone), options.now),
    seededAppointment("eli-appt", "eli", "devon", beard, at(demoDate, 15, 0, options.timezone), options.now),
    seededAppointment("imani-appt", "imani", "maya", haircut, at(demoDate, 15, 0, options.timezone), options.now),
    seededAppointment("tue-marco", "marco", "jeremy", beard, at(operationalDate(1), 11, 0, options.timezone), options.now),
    seededAppointment("tue-nadia", "nadia", "maya", haircut, at(operationalDate(1), 10, 0, options.timezone), options.now),
    seededAppointment("tue-imani", "imani", "maya", fade, at(operationalDate(1), 14, 0, options.timezone), options.now),
    seededAppointment("tue-eli", "eli", "devon", haircut, at(operationalDate(1), 12, 0, options.timezone), options.now),
    seededAppointment("tue-marco-late", "marco", "devon", beard, at(operationalDate(1), 16, 0, options.timezone), options.now),
    seededAppointment("wed-nadia", "nadia", "jeremy", fade, at(operationalDate(2), 10, 0, options.timezone), options.now),
    seededAppointment("wed-marco", "marco", "jeremy", haircut, at(operationalDate(2), 14, 0, options.timezone), options.now),
    seededAppointment("wed-imani-early", "imani", "maya", fade, at(operationalDate(2), 11, 0, options.timezone), options.now),
    seededAppointment("wed-imani", "imani", "devon", haircut, at(operationalDate(2), 16, 0, options.timezone), options.now),
    seededAppointment("thu-eli", "eli", "jeremy", beard, at(operationalDate(3), 10, 0, options.timezone), options.now),
    seededAppointment("thu-marco-early", "marco", "jeremy", haircut, at(operationalDate(3), 13, 0, options.timezone), options.now),
    seededAppointment("thu-imani", "imani", "maya", haircut, at(operationalDate(3), 15, 0, options.timezone), options.now),
    seededAppointment("thu-marco", "marco", "devon", beard, at(operationalDate(3), 16, 0, options.timezone), options.now),
    seededAppointment("fri-nadia", "nadia", "jeremy", haircut, at(operationalDate(4), 11, 0, options.timezone), options.now),
    seededAppointment("fri-marco", "marco", "maya", fade, at(operationalDate(4), 14, 0, options.timezone), options.now),
    seededAppointment("fri-eli", "eli", "devon", haircut, at(operationalDate(4), 10, 0, options.timezone), options.now),
    seededAppointment("fri-imani", "imani", "devon", beard, at(operationalDate(4), 16, 0, options.timezone), options.now),
    seededAppointment(
      "marco-history",
      "marco",
      "jeremy",
      haircut,
      at(DateTime.fromISO(demoDate).minus({ days: 21 }).toISODate()!, 14, 0, options.timezone),
      options.now,
      "cancelled",
    ),
  ];
  fillBusyWeek({
    appointments,
    customers,
    barbers,
    services,
    demoDate,
    timezone: options.timezone,
    now: options.now,
  });
  addRecurringCustomerHistory({
    appointments,
    customers,
    barbers,
    services,
    demoDate,
    timezone: options.timezone,
  });
  const agentSeed = createAgentConversationSeed({
    now: options.now,
    demoDate,
    timezone: options.timezone,
    haircut,
  });
  appointments.push(...agentSeed.appointments);
  const settings: SchedulingSettings = {
    timezone: options.timezone,
    refillEnabled: true,
    moveEarlierEnabled: true,
    moveLimit: 3,
    allowAlternateBarbers: true,
    waitlistEnabled: true,
    pastCustomerOutreachEnabled: true,
    maxDiscountPercent: 15,
    offerExpirySeconds: 120,
  };

  return {
    customers,
    barbers,
    services,
    appointments,
    waitlist: [
      {
        id: "alex-waitlist",
        customerId: "alex",
        serviceId: haircut.id,
        barberId: "jeremy",
        date: demoDate,
        earliestStart: "14:00",
        latestStart: "16:00",
        status: "active",
        createdAt: DateTime.fromISO(options.now).minus({ hours: 1 }).toUTC().toISO()!,
        updatedAt: options.now,
      },
      {
        id: "nadia-waitlist",
        customerId: "nadia",
        serviceId: fade.id,
        date: operationalDate(1),
        earliestStart: "14:00",
        latestStart: "16:00",
        status: "active",
        createdAt: DateTime.fromISO(options.now).minus({ minutes: 42 }).toUTC().toISO()!,
        updatedAt: options.now,
      },
      {
        id: "marco-waitlist",
        customerId: "marco",
        serviceId: beard.id,
        barberId: "devon",
        date: operationalDate(3),
        earliestStart: "11:00",
        latestStart: "15:00",
        status: "active",
        operatorNote: "Afternoons are easiest; a short-notice call is okay.",
        createdAt: DateTime.fromISO(options.now).minus({ minutes: 18 }).toUTC().toISO()!,
        updatedAt: options.now,
      },
      {
        id: "gabriel-waitlist",
        customerId: "gabriel",
        serviceId: fade.id,
        barberId: "maya",
        date: operationalDate(2),
        earliestStart: "12:00",
        latestStart: "16:00",
        status: "active",
        operatorNote: "Prefers Maya; available over lunch or mid-afternoon.",
        createdAt: DateTime.fromISO(options.now).minus({ hours: 3 }).toUTC().toISO()!,
        updatedAt: options.now,
      },
      {
        id: "nora-waitlist",
        customerId: "nora",
        serviceId: haircut.id,
        date: operationalDate(4),
        earliestStart: "17:00",
        latestStart: "19:30",
        status: "active",
        operatorNote: "Any barber after work; Telegram is fastest.",
        createdAt: DateTime.fromISO(options.now).minus({ hours: 2 }).toUTC().toISO()!,
        updatedAt: options.now,
      },
    ],
    refillJobs: agentSeed.refillJobs,
    offers: agentSeed.offers,
    processedEvents: [],
    backboardThreads: [],
    conversations: agentSeed.conversations,
    conversationEvents: agentSeed.conversationEvents,
    customerNotes: [
      {
        id: "sarah-note",
        customerId: "sarah",
        text: "Prefers a phone call for same-day appointment changes.",
        author: "operator",
        createdAt: DateTime.fromISO(options.now).minus({ days: 2 }).toUTC().toISO()!,
      },
      {
        id: "nadia-note",
        customerId: "nadia",
        text: "Comfortable with any qualified barber.",
        author: "operator",
        createdAt: DateTime.fromISO(options.now).minus({ days: 1 }).toUTC().toISO()!,
      },
    ],
    events: [{
      id: "demo-reset-event",
      type: "demo.reset",
      aggregateId: demoDate,
      occurredAt: options.now,
      data: { demoDate },
    }],
    settings,
  };
}
