import { DateTime } from "luxon";
import { z } from "zod";

import type { StandbyEngine } from "../../domain/engine.js";
import { findAvailableSlots } from "../../domain/scheduling.js";
import {
  isShopWeekend,
  SHOP_CLOSED_MESSAGE,
  SHOP_HOURS_LABEL,
} from "../../domain/shop-hours.js";
import type { StandbyStore } from "../../domain/store.js";
import type { ActorContext, Barber } from "../../domain/types.js";
import type { ToolDefinition } from "./backboard.js";

const availabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_id: z.string(),
  barber_id: z.string().optional(),
  include_alternates: z.boolean().default(false),
}).strict();
const emptySchema = z.object({}).strict();
const bookingSchema = z.object({
  barber_id: z.string(),
  service_id: z.string(),
  start_at: z.string(),
  confirmed: z.boolean(),
}).strict();
const cancellationSchema = z.object({ appointment_id: z.string() }).strict();
const rescheduleSchema = z.object({
  appointment_id: z.string(),
  barber_id: z.string(),
  start_at: z.string(),
  confirmed: z.boolean(),
}).strict();
const offerResponseSchema = z.object({
  offer_id: z.string(),
  response: z.enum(["accept", "decline"]),
  confirmed: z.boolean(),
}).strict();
const shopInfoSchema = z.object({
  topic: z.enum(["hours", "location", "services", "policies", "all"]),
}).strict();

function normalizedLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function resolveBarber(barbers: Barber[], supplied: string): Barber | undefined {
  const label = normalizedLabel(supplied);
  const exact = barbers.find((barber) => (
    normalizedLabel(barber.id) === label || normalizedLabel(barber.name) === label
  ));
  if (exact !== undefined) return exact;
  const nearby = barbers
    .map((barber) => ({
      barber,
      distance: Math.min(
        editDistance(label, normalizedLabel(barber.id)),
        editDistance(label, normalizedLabel(barber.name)),
      ),
    }))
    .filter((candidate) => candidate.distance <= 1)
    .sort((left, right) => left.distance - right.distance);
  if (nearby.length === 0 || nearby[1]?.distance === nearby[0]?.distance) return undefined;
  return nearby[0]?.barber;
}

export class SchedulingToolbox {
  readonly definitions: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "get_availability",
        description: "Get live appointment openings for a date and service. Use include_alternates only when the customer asks for any qualified barber or agrees to alternatives.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Local shop date in YYYY-MM-DD format." },
            service_id: { type: "string", description: "Service identifier returned by shop information." },
            barber_id: { type: "string", description: "Requested barber identifier from get_shop_info, if any. Spoken barber names are also accepted." },
            include_alternates: { type: "boolean", description: "Whether qualified alternate barbers may be returned." },
          },
          required: ["date", "service_id", "include_alternates"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_my_appointments",
        description: "List live confirmed appointments belonging to the authenticated customer.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "book_appointment",
        description: "Propose or commit a booking for the authenticated customer. Set confirmed true only after the customer clearly confirms the exact barber, service, and time.",
        parameters: {
          type: "object",
          properties: {
            barber_id: { type: "string" },
            service_id: { type: "string" },
            start_at: { type: "string", description: "ISO 8601 time from live availability." },
            confirmed: { type: "boolean" },
          },
          required: ["barber_id", "service_id", "start_at", "confirmed"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "cancel_appointment",
        description: "Cancel one identified appointment belonging to the authenticated customer. A direct unambiguous cancellation is explicit consent.",
        parameters: {
          type: "object",
          properties: { appointment_id: { type: "string" } },
          required: ["appointment_id"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reschedule_appointment",
        description: "Propose or commit an appointment move. Set confirmed true only after the customer confirms the exact new barber and time.",
        parameters: {
          type: "object",
          properties: {
            appointment_id: { type: "string" },
            barber_id: { type: "string" },
            start_at: { type: "string" },
            confirmed: { type: "boolean" },
          },
          required: ["appointment_id", "barber_id", "start_at", "confirmed"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "respond_to_offer",
        description: "Accept or decline an active opening offered to the authenticated customer. Set confirmed true for accept only after an explicit yes; a direct decline may be committed immediately.",
        parameters: {
          type: "object",
          properties: {
            offer_id: { type: "string" },
            response: { type: "string", enum: ["accept", "decline"] },
            confirmed: { type: "boolean" },
          },
          required: ["offer_id", "response", "confirmed"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_shop_info",
        description: "Answer deterministic questions about Standby's hours, location, services, and scheduling policies.",
        parameters: {
          type: "object",
          properties: { topic: { type: "string", enum: ["hours", "location", "services", "policies", "all"] } },
          required: ["topic"],
          additionalProperties: false,
        },
      },
    },
  ];

  constructor(
    private readonly store: StandbyStore,
    private readonly engine: StandbyEngine,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async execute(name: string, input: unknown, actor: ActorContext): Promise<unknown> {
    try {
      if (name === "get_shop_info") return this.getShopInfo(shopInfoSchema.parse(input));
      if (name === "get_availability") return this.getAvailability(availabilitySchema.parse(input));
      if (actor.customerId === undefined) {
        return { type: "error", code: "UNLINKED_ACTOR", message: "The caller is not linked to a Standby customer." };
      }
      if (name === "get_my_appointments") {
        emptySchema.parse(input);
        return this.getAppointments(actor.customerId);
      }
      if (name === "book_appointment") {
        const value = bookingSchema.parse(input);
        return this.engine.book({
          actor,
          customerId: actor.customerId,
          barberId: value.barber_id,
          serviceId: value.service_id,
          startAt: value.start_at,
          confirmed: value.confirmed,
          now: this.clock(),
        });
      }
      if (name === "cancel_appointment") {
        const value = cancellationSchema.parse(input);
        return this.engine.cancel({ actor, appointmentId: value.appointment_id, now: this.clock() });
      }
      if (name === "reschedule_appointment") {
        const value = rescheduleSchema.parse(input);
        return this.engine.reschedule({
          actor,
          appointmentId: value.appointment_id,
          barberId: value.barber_id,
          startAt: value.start_at,
          confirmed: value.confirmed,
          now: this.clock(),
        });
      }
      if (name === "respond_to_offer") {
        const value = offerResponseSchema.parse(input);
        return this.engine.respondToOffer({
          actor,
          offerId: value.offer_id,
          response: value.response,
          confirmed: value.confirmed,
          now: this.clock(),
        });
      }
      return { type: "error", code: "UNKNOWN_TOOL", message: "That scheduling operation is not supported." };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { type: "error", code: "INVALID_TOOL_ARGUMENTS", message: "The scheduling request was incomplete or invalid." };
      }
      return { type: "error", code: "TOOL_ERROR", message: "Standby could not complete that scheduling operation." };
    }
  }

  private async getAppointments(customerId: string) {
    const state = await this.store.read();
    const customer = state.customers.find((candidate) => candidate.id === customerId);
    const appointments = state.appointments
      .filter((appointment) => appointment.customerId === customerId && appointment.status === "confirmed")
      .map((appointment) => ({
        ...appointment,
        customerName: customer?.name ?? "Customer",
        barberName: state.barbers.find((barber) => barber.id === appointment.barberId)?.name ?? "Unknown barber",
        serviceName: state.services.find((service) => service.id === appointment.serviceId)?.name ?? "Unknown service",
        localTime: DateTime.fromISO(appointment.startAt)
          .setZone(state.settings.timezone)
          .toFormat("cccc, LLLL d 'at' h:mm a"),
      }));
    return { appointments };
  }

  private async getAvailability(input: z.infer<typeof availabilitySchema>) {
    const state = await this.store.read();
    const service = state.services.find((candidate) => candidate.id === input.service_id);
    if (service === undefined) {
      return { type: "error", code: "NOT_FOUND", message: "That service was not found." };
    }
    const requestedBarber = input.barber_id === undefined
      ? undefined
      : resolveBarber(state.barbers, input.barber_id);
    if (input.barber_id !== undefined && requestedBarber === undefined) {
      return {
        type: "error",
        code: "NOT_FOUND",
        message: "That barber was not found. Use one of the listed barber identifiers.",
        barbers: state.barbers.map((barber) => ({ id: barber.id, name: barber.name })),
      };
    }
    const slots = findAvailableSlots({
      date: input.date,
      timezone: state.settings.timezone,
      service,
      barbers: state.barbers,
      appointments: state.appointments,
      ...(requestedBarber === undefined ? {} : { requestedBarberId: requestedBarber.id }),
      includeAlternates: input.include_alternates && state.settings.allowAlternateBarbers,
    }).map((slot) => ({
      ...slot,
      barberName: state.barbers.find((barber) => barber.id === slot.barberId)?.name ?? "Unknown barber",
      localTime: DateTime.fromISO(slot.startAt).setZone(state.settings.timezone).toFormat("h:mm a"),
    }));
    const requestedDate = DateTime.fromISO(input.date, { zone: state.settings.timezone });
    const closed = requestedDate.isValid && isShopWeekend(requestedDate.weekday);
    return {
      date: input.date,
      service: service.name,
      timezone: state.settings.timezone,
      slots,
      ...(closed ? { closed: true, message: SHOP_CLOSED_MESSAGE } : {}),
    };
  }

  private async getShopInfo(input: z.infer<typeof shopInfoSchema>) {
    const state = await this.store.read();
    return {
      topic: input.topic,
      name: "Standby",
      location: "Toronto, Ontario",
      timezone: state.settings.timezone,
      hours: SHOP_HOURS_LABEL,
      services: state.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: `$${(service.priceCents / 100).toFixed(0)}`,
      })),
      barbers: state.barbers.map((barber) => ({
        id: barber.id,
        name: barber.name,
        serviceIds: barber.serviceIds,
      })),
      policies: {
        earlierMovesRequireOptIn: true,
        alternateBarbersAllowed: state.settings.allowAlternateBarbers,
        maximumPastCustomerDiscountPercent: state.settings.maxDiscountPercent,
      },
    };
  }
}
