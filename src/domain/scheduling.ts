import { DateTime, Interval } from "luxon";

import type {
  Appointment,
  AvailabilitySlot,
  Barber,
  Customer,
  RefillCandidate,
  RefillJob,
  SchedulingSettings,
  Service,
  WaitlistEntry,
} from "./types.js";

interface AvailabilityInput {
  date: string;
  timezone: string;
  service: Service;
  barbers: Barber[];
  appointments: Appointment[];
  intervalMinutes?: number;
  requestedBarberId?: string;
  includeAlternates?: boolean;
}

interface RankCandidatesInput {
  job: RefillJob;
  customers: Customer[];
  appointments: Appointment[];
  waitlist: WaitlistEntry[];
  settings: SchedulingSettings;
  now: string;
}

function requireValidDateTime(value: string, zone?: string): DateTime {
  const parsed = DateTime.fromISO(value, zone === undefined ? undefined : { zone });
  if (!parsed.isValid) {
    throw new Error(`Invalid ISO date/time: ${value}`);
  }
  return parsed;
}

function overlaps(startAt: DateTime, endAt: DateTime, appointment: Appointment): boolean {
  if (appointment.status !== "confirmed") return false;
  const appointmentStart = requireValidDateTime(appointment.startAt);
  const appointmentEnd = requireValidDateTime(appointment.endAt);
  return Interval.fromDateTimes(startAt, endAt).overlaps(
    Interval.fromDateTimes(appointmentStart, appointmentEnd),
  );
}

export function findAvailableSlots(input: AvailabilityInput): AvailabilitySlot[] {
  const day = requireValidDateTime(`${input.date}T00:00:00`, input.timezone);
  const duration = input.service.durationMinutes;
  const interval = input.intervalMinutes ?? 30;
  const eligibleBarbers = input.barbers
    .filter((candidate) => candidate.serviceIds.includes(input.service.id))
    .filter((candidate) => {
      if (input.requestedBarberId === undefined) return true;
      return input.includeAlternates === true || candidate.id === input.requestedBarberId;
    })
    .sort((left, right) => {
      if (left.id === input.requestedBarberId) return -1;
      if (right.id === input.requestedBarberId) return 1;
      return left.name.localeCompare(right.name);
    });

  return eligibleBarbers.flatMap((candidate) => {
    const workingPeriods = candidate.weeklyHours[day.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7] ?? [];
    const barberAppointments = input.appointments.filter((item) => item.barberId === candidate.id);

    return workingPeriods.flatMap((period) => {
      const periodStart = requireValidDateTime(`${input.date}T${period.start}:00`, input.timezone);
      const periodEnd = requireValidDateTime(`${input.date}T${period.end}:00`, input.timezone);
      const slots: AvailabilitySlot[] = [];

      for (
        let cursor = periodStart;
        cursor.plus({ minutes: duration }).toMillis() <= periodEnd.toMillis();
        cursor = cursor.plus({ minutes: interval })
      ) {
        const endAt = cursor.plus({ minutes: duration });
        if (!barberAppointments.some((appointment) => overlaps(cursor, endAt, appointment))) {
          slots.push({
            barberId: candidate.id,
            startAt: cursor.toUTC().toISO()!,
            endAt: endAt.toUTC().toISO()!,
          });
        }
      }

      return slots;
    });
  });
}

function isWaitlistMatch(
  entry: WaitlistEntry,
  job: RefillJob,
  timezone: string,
): boolean {
  if (entry.status !== "active" || entry.serviceId !== job.serviceId) return false;
  if (entry.barberId !== undefined && entry.barberId !== job.barberId) return false;
  const localSlot = requireValidDateTime(job.slotStartAt).setZone(timezone);
  const localTime = localSlot.toFormat("HH:mm");
  return entry.date === localSlot.toISODate()
    && localTime >= entry.earliestStart
    && localTime <= entry.latestStart;
}

function acceptsReplacementOffers(customer: Customer): boolean {
  return customer.replacementOffersEnabled !== false;
}

export function rankRefillCandidates(input: RankCandidatesInput): RefillCandidate[] {
  const customerById = new Map(input.customers.map((candidate) => [candidate.id, candidate]));
  const attempted = new Set(input.job.attemptedCustomerIds);
  const ranked: RefillCandidate[] = [];
  const selected = new Set<string>();
  const jobStart = requireValidDateTime(input.job.slotStartAt);
  const localJobDate = jobStart.setZone(input.settings.timezone).toISODate();

  if (input.settings.moveEarlierEnabled && input.job.moveDepth < input.settings.moveLimit) {
    const laterAppointments = input.appointments
      .filter((appointment) => appointment.status === "confirmed")
      .filter((appointment) => appointment.barberId === input.job.barberId)
      .filter((appointment) => appointment.serviceId === input.job.serviceId)
      .filter((appointment) => requireValidDateTime(appointment.startAt).toMillis() > jobStart.toMillis())
      .filter((appointment) => (
        requireValidDateTime(appointment.startAt).setZone(input.settings.timezone).toISODate() === localJobDate
      ))
      .sort((left, right) => left.startAt.localeCompare(right.startAt));

    for (const appointment of laterAppointments) {
      const customer = customerById.get(appointment.customerId);
      if (
        customer === undefined
        || !acceptsReplacementOffers(customer)
        || !customer.earlierMoveConsent
        || attempted.has(customer.id)
        || selected.has(customer.id)
      ) continue;
      ranked.push({
        customerId: customer.id,
        kind: "move_earlier",
        channel: customer.contactPreference,
        appointmentId: appointment.id,
      });
      selected.add(customer.id);
    }
  }

  if (input.settings.waitlistEnabled) {
    const matchingEntries = input.waitlist
      .filter((entry) => isWaitlistMatch(entry, input.job, input.settings.timezone))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const entry of matchingEntries) {
      const customer = customerById.get(entry.customerId);
      if (
        customer === undefined
        || !acceptsReplacementOffers(customer)
        || attempted.has(customer.id)
        || selected.has(customer.id)
      ) continue;
      ranked.push({
        customerId: customer.id,
        kind: "waitlist",
        channel: customer.contactPreference,
        waitlistEntryId: entry.id,
      });
      selected.add(customer.id);
    }
  }

  if (input.settings.pastCustomerOutreachEnabled) {
    const now = requireValidDateTime(input.now);
    const serviceCustomerIds = new Set(
      input.appointments
        .filter((appointment) => appointment.serviceId === input.job.serviceId)
        .filter((appointment) => requireValidDateTime(appointment.startAt).toMillis() < now.toMillis())
        .map((appointment) => appointment.customerId),
    );
    const eligiblePastCustomers = input.customers
      .filter(acceptsReplacementOffers)
      .filter((customer) => customer.pastCustomerOptIn)
      .filter((customer) => serviceCustomerIds.has(customer.id))
      .filter((customer) => !attempted.has(customer.id) && !selected.has(customer.id))
      .filter((customer) => {
        if (customer.lastOutreachAt === undefined) return true;
        return now.diff(requireValidDateTime(customer.lastOutreachAt), "days").days >= 7;
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const customer of eligiblePastCustomers) {
      ranked.push({
        customerId: customer.id,
        kind: "past_customer",
        channel: customer.contactPreference,
      });
      selected.add(customer.id);
    }
  }

  return ranked;
}

export function calculatePastCustomerDiscount(
  previousPastCustomerOffers: number,
  maxDiscountPercent: number,
): number {
  const progressiveDiscount = Math.min(15, (previousPastCustomerOffers + 1) * 5);
  return Math.max(0, Math.min(progressiveDiscount, maxDiscountPercent));
}
