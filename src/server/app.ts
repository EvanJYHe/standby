import { randomUUID, timingSafeEqual } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import rawBody from "fastify-raw-body";
import { DateTime } from "luxon";
import { z, ZodError } from "zod";

import type { OperationResult, StandbyEngine } from "../domain/engine.js";
import { findAvailableSlots } from "../domain/scheduling.js";
import {
  isShopWeekend,
  SHOP_CLOSED_MESSAGE,
  SHOP_CLOSE_TIME,
  SHOP_OPEN_TIME,
} from "../domain/shop-hours.js";
import type { StandbyStore } from "../domain/store.js";
import type { SchedulingSettings } from "../domain/types.js";
import type { AppConfig } from "./config.js";
import {
  projectActivity,
  projectConversationDetail,
  projectConversationList,
  projectCustomerDetail,
  projectCustomerList,
  projectWaitlist,
} from "./operator-projections.js";
import type { ElevenLabsWebhookService } from "./providers/elevenlabs.js";
import type { TelegramWebhookHandler } from "./providers/telegram.js";
import { createDemoState, getDemoDate } from "./seed.js";

interface BuildServerOptions {
  config: AppConfig;
  store: StandbyStore;
  engine: StandbyEngine;
  clock?: () => string;
  storeKind?: "memory" | "mongodb";
  telegramWebhook?: TelegramWebhookHandler;
  elevenLabsWebhooks?: ElevenLabsWebhookService;
}

const settingsPatchSchema = z.object({
  refillEnabled: z.boolean().optional(),
  moveEarlierEnabled: z.boolean().optional(),
  moveLimit: z.number().int().min(0).max(3).optional(),
  allowAlternateBarbers: z.boolean().optional(),
  waitlistEnabled: z.boolean().optional(),
  pastCustomerOutreachEnabled: z.boolean().optional(),
  maxDiscountPercent: z.number().int().min(0).max(15).optional(),
  offerExpirySeconds: z.number().int().min(30).max(900).optional(),
}).strict();

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const calendarQuerySchema = z.object({
  date: isoDateSchema.optional(),
  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
}).strict().superRefine((value, context) => {
  const hasDate = value.date !== undefined;
  const hasRange = value.start !== undefined || value.end !== undefined;
  if (hasDate === hasRange || (hasRange && (value.start === undefined || value.end === undefined))) {
    context.addIssue({ code: "custom", message: "Provide either date or start and end." });
  }
});


const availabilityQuerySchema = z.object({
  date: isoDateSchema,
  serviceId: z.string().min(1),
  barberId: z.string().min(1).optional(),
  includeAlternates: z.enum(["true", "false"]).optional(),
}).strict();

const appointmentCreateSchema = z.object({
  customerId: z.string().min(1),
  barberId: z.string().min(1),
  serviceId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
}).strict();

const appointmentMoveSchema = z.object({
  barberId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
}).strict();

const customerPatchSchema = z.object({
  contactPreference: z.enum(["telegram", "voice"]).optional(),
  replacementOffersEnabled: z.boolean().optional(),
  earlierMoveConsent: z.boolean().optional(),
  flexibleBarberPreference: z.boolean().optional(),
  pastCustomerOptIn: z.boolean().optional(),
}).strict();

const customerNoteSchema = z.object({
  text: z.string().trim().min(1).max(500),
}).strict();

const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contactPreference: z.enum(["telegram", "voice"]).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
}).strict();

const waitlistPatchSchema = z.object({
  status: z.enum(["active", "paused", "withdrawn"]).optional(),
  operatorNote: z.string().trim().max(500).nullable().optional(),
}).strict();

function safeSecretEqual(provided: string | undefined, expected: string | undefined): boolean {
  if (provided === undefined || expected === undefined) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendOperation(reply: FastifyReply, result: OperationResult) {
  if (result.type === "conflict") return reply.status(409).send(result);
  if (result.type === "error") {
    return reply.status(result.code === "NOT_FOUND" ? 404 : 400).send(result);
  }
  if (result.type === "confirmation_required") return reply.status(400).send(result);
  return reply.send(result);
}

function providerReadiness(config: AppConfig, storeKind: "memory" | "mongodb") {
  return {
    mongodb: storeKind,
    telegram: config.telegramBotToken !== undefined && config.telegramWebhookSecret !== undefined
      ? "configured"
      : "unconfigured",
    backboard: config.backboardApiKey !== undefined && config.backboardAssistantId !== undefined
      ? "configured"
      : "unconfigured",
    elevenlabs: config.elevenLabsApiKey !== undefined
      && config.elevenLabsAgentId !== undefined
      && config.elevenLabsPhoneNumberId !== undefined
      && config.elevenLabsWebhookSecret !== undefined
      && config.sarahPhone !== undefined
      ? "configured"
      : "unconfigured",
  } as const;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const clock = options.clock ?? (() => new Date().toISOString());
  const storeKind = options.storeKind ?? (options.config.mongoUri === undefined ? "memory" : "mongodb");
  const app = Fastify({
    logger: options.config.nodeEnv === "test" ? false : {
      level: options.config.nodeEnv === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.headers.x-telegram-bot-api-secret-token",
        "req.headers.elevenlabs-signature",
      ],
    },
  });
  await app.register(rawBody, {
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: "invalid_request",
        message: "The request did not match the expected format.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }
    request.log.error({ err: error }, "request failed");
    void reply.status(500).send({ error: "internal_error", message: "Standby could not complete the request." });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "standby",
    time: clock(),
    providers: providerReadiness(options.config, storeKind),
  }));

  app.post("/webhooks/telegram", async (request, reply) => {
    if (options.telegramWebhook === undefined || options.config.telegramWebhookSecret === undefined) {
      return reply.status(503).send({ error: "telegram_unconfigured" });
    }
    const supplied = request.headers["x-telegram-bot-api-secret-token"];
    if (!safeSecretEqual(
      typeof supplied === "string" ? supplied : supplied?.[0],
      options.config.telegramWebhookSecret,
    )) {
      return reply.status(401).send({ error: "invalid_telegram_secret" });
    }
    const result = await options.telegramWebhook.handle(request.body);
    return { ok: true, ...result };
  });

  app.post("/webhooks/elevenlabs/context", async (request, reply) => {
    if (options.elevenLabsWebhooks === undefined || options.config.elevenLabsWebhookSecret === undefined) {
      return reply.status(503).send({ error: "elevenlabs_unconfigured" });
    }
    const supplied = request.headers["x-standby-webhook-secret"];
    if (!safeSecretEqual(
      typeof supplied === "string" ? supplied : supplied?.[0],
      options.config.elevenLabsWebhookSecret,
    )) {
      return reply.status(401).send({ error: "invalid_elevenlabs_secret" });
    }
    return options.elevenLabsWebhooks.inboundContext(request.body);
  });

  app.post<{ Params: { tool: string } }>("/webhooks/elevenlabs/tools/:tool", async (request, reply) => {
    if (options.elevenLabsWebhooks === undefined) {
      return reply.status(503).send({ error: "elevenlabs_unconfigured" });
    }
    const result = await options.elevenLabsWebhooks.executeTool(
      request.params.tool,
      request.body,
      request.headers.authorization,
    );
    const summary = typeof result === "object" && result !== null
      ? result as { type?: unknown; code?: unknown; operation?: unknown }
      : {};
    request.log.info({
      tool: request.params.tool,
      resultType: typeof summary.type === "string" ? summary.type : "unknown",
      ...(typeof summary.code === "string" ? { code: summary.code } : {}),
      ...(typeof summary.operation === "string" ? { operation: summary.operation } : {}),
    }, "ElevenLabs scheduling tool completed");
    return result;
  });

  app.post("/webhooks/elevenlabs/post-call", {
    config: { rawBody: true },
  }, async (request, reply) => {
    if (options.elevenLabsWebhooks === undefined) {
      return reply.status(503).send({ error: "elevenlabs_unconfigured" });
    }
    const signature = request.headers["elevenlabs-signature"];
    const raw = typeof request.rawBody === "string"
      ? request.rawBody
      : request.rawBody?.toString("utf8");
    if (raw === undefined) return reply.status(400).send({ error: "missing_raw_body" });
    try {
      return await options.elevenLabsWebhooks.handlePostCall(
        raw,
        typeof signature === "string" ? signature : signature?.[0],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return reply.status(message.includes("signature") ? 401 : 400).send({
        error: message.includes("signature") ? "invalid_signature" : "invalid_webhook",
      });
    }
  });

  app.get("/api/v1/calendar", async (request, reply) => {
    const query = calendarQuerySchema.parse(request.query);
    const start = query.date ?? query.start!;
    const end = query.date ?? query.end!;
    const localStart = DateTime.fromISO(start, { zone: options.config.timezone });
    const localEnd = DateTime.fromISO(end, { zone: options.config.timezone });
    const rangeDays = localEnd.diff(localStart, "days").days;
    if (
      !localStart.isValid
      || !localEnd.isValid
      || localStart.toISODate() !== start
      || localEnd.toISODate() !== end
      || rangeDays < 0
      || rangeDays > 41
    ) {
      return reply.status(400).send({ error: "invalid_date" });
    }
    const state = await options.store.read();
    const customerById = new Map(state.customers.map((customer) => [customer.id, customer]));
    const barberById = new Map(state.barbers.map((barber) => [barber.id, barber]));
    const serviceById = new Map(state.services.map((service) => [service.id, service]));
    const inRange = (iso: string) => {
      const localDate = DateTime.fromISO(iso).setZone(state.settings.timezone).toISODate();
      return localDate !== null && localDate >= start && localDate <= end;
    };
    const appointments = state.appointments
      .filter((appointment) => inRange(appointment.startAt))
      .map((appointment) => ({
        ...appointment,
        customerName: customerById.get(appointment.customerId)?.name ?? "Unknown customer",
        barberName: barberById.get(appointment.barberId)?.name ?? "Unknown barber",
        serviceName: serviceById.get(appointment.serviceId)?.name ?? "Unknown service",
      }))
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
    const activeRefills = state.refillJobs
      .filter((job) => inRange(job.slotStartAt))
      .filter((job) => !["completed", "cancelled", "exhausted", "failed"].includes(job.status))
      .map((job) => {
        const offer = job.currentOfferId === undefined
          ? undefined
          : state.offers.find((candidate) => candidate.id === job.currentOfferId);
        const waitingFor = offer === undefined ? undefined : customerById.get(offer.customerId)?.name;
        return {
          ...job,
          barberName: barberById.get(job.barberId)?.name ?? "Unknown barber",
          serviceName: serviceById.get(job.serviceId)?.name ?? "Unknown service",
          customerState: waitingFor === undefined ? "Finding a replacement…" : `Waiting for ${waitingFor}.`,
        };
      });
    return {
      date: start,
      range: { start, end },
      timezone: state.settings.timezone,
      generatedAt: clock(),
      shop: { name: "Standby", location: "Toronto, ON" },
      businessHours: { start: SHOP_OPEN_TIME, end: SHOP_CLOSE_TIME },
      barbers: state.barbers,
      services: state.services,
      appointments,
      activeRefills,
      channelHealth: providerReadiness(options.config, storeKind),
      demoDate: getDemoDate(clock(), state.settings.timezone),
    };
  });

  app.get("/api/v1/settings", async () => (await options.store.read()).settings);

  app.patch("/api/v1/settings", async (request) => {
    const patch = settingsPatchSchema.parse(request.body);
    return options.store.transaction((state) => {
      state.settings = { ...state.settings, ...patch } as SchedulingSettings;
      state.events.push({
        id: crypto.randomUUID(),
        type: "settings.updated",
        aggregateId: "shop",
        occurredAt: clock(),
        data: patch,
      });
      return state.settings;
    });
  });

  app.get("/api/v1/availability", async (request, reply) => {
    const query = availabilityQuerySchema.parse(request.query);
    const date = DateTime.fromISO(query.date, { zone: options.config.timezone });
    if (!date.isValid || date.toISODate() !== query.date) {
      return reply.status(400).send({ error: "invalid_date" });
    }
    const state = await options.store.read();
    const service = state.services.find((candidate) => candidate.id === query.serviceId);
    if (service === undefined) return reply.status(404).send({ error: "service_not_found" });
    const closed = isShopWeekend(date.weekday);
    const slots = findAvailableSlots({
      date: query.date,
      timezone: state.settings.timezone,
      service,
      barbers: state.barbers,
      appointments: state.appointments,
      ...(query.barberId === undefined ? {} : { requestedBarberId: query.barberId }),
      includeAlternates: query.includeAlternates === "true" && state.settings.allowAlternateBarbers,
    }).map((slot) => ({
      ...slot,
      barberName: state.barbers.find((barber) => barber.id === slot.barberId)?.name ?? "Unknown barber",
      localTime: DateTime.fromISO(slot.startAt).setZone(state.settings.timezone).toFormat("h:mm a"),
    }));
    return {
      date: query.date,
      timezone: state.settings.timezone,
      service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
      slots,
      ...(closed ? { closed: true, message: SHOP_CLOSED_MESSAGE } : {}),
    };
  });

  app.post("/api/v1/appointments", async (request, reply) => {
    const input = appointmentCreateSchema.parse(request.body);
    const result = await options.engine.book({
      actor: { provider: "admin" },
      customerId: input.customerId,
      barberId: input.barberId,
      serviceId: input.serviceId,
      startAt: input.startAt,
      confirmed: true,
      now: clock(),
    });
    return sendOperation(reply, result);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/appointments/:id", async (request, reply) => {
    const input = appointmentMoveSchema.parse(request.body);
    const result = await options.engine.reschedule({
      actor: { provider: "admin" },
      appointmentId: request.params.id,
      barberId: input.barberId,
      startAt: input.startAt,
      confirmed: true,
      now: clock(),
    });
    return sendOperation(reply, result);
  });

  app.post<{ Params: { id: string } }>("/api/v1/appointments/:id/cancel", async (request, reply) => {
    const result = await options.engine.cancel({
      actor: { provider: "admin" },
      appointmentId: request.params.id,
      now: clock(),
    });
    return sendOperation(reply, result);
  });

  app.get("/api/v1/customers", async (request) => {
    const query = z.object({ q: z.string().max(100).optional() }).strict().parse(request.query);
    return projectCustomerList(await options.store.read(), query.q ?? "");
  });

  app.get("/api/v1/customer-workspace", async (request) => {
    const query = z.object({ selectedId: z.string().max(100).optional() }).strict().parse(request.query);
    const state = await options.store.read();
    const customers = projectCustomerList(state);
    const selectedId = query.selectedId !== undefined
      && customers.some((customer) => customer.id === query.selectedId)
      ? query.selectedId
      : customers[0]?.id;
    const selectedCustomer = selectedId === undefined ? undefined : projectCustomerDetail(state, selectedId);
    return {
      customers,
      ...(selectedCustomer === undefined ? {} : { selectedCustomer }),
      generatedAt: clock(),
    };
  });

  app.post("/api/v1/customers", async (request, reply) => {
    const input = customerCreateSchema.parse(request.body);
    const created = await options.store.transaction((state) => {
      const customer = {
        id: randomUUID(),
        name: input.name,
        contactPreference: input.contactPreference ?? "telegram",
        earlierMoveConsent: false,
        flexibleBarberPreference: false,
        pastCustomerOptIn: false,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        createdAt: clock(),
        updatedAt: clock(),
      };
      state.customers.push(customer);
      state.events.push({
        id: randomUUID(),
        type: "customer.created",
        aggregateId: customer.id,
        occurredAt: clock(),
        data: { customerId: customer.id },
      });
      return customer;
    });
    const summary = projectCustomerList(await options.store.read()).find((entry) => entry.id === created.id);
    return reply.status(201).send(summary);
  });

  app.get<{ Params: { id: string } }>("/api/v1/customers/:id", async (request, reply) => {
    const detail = projectCustomerDetail(await options.store.read(), request.params.id);
    return detail ?? reply.status(404).send({ error: "not_found" });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/customers/:id", async (request, reply) => {
    const patch = customerPatchSchema.parse(request.body);
    const found = await options.store.transaction((state) => {
      const customer = state.customers.find((candidate) => candidate.id === request.params.id);
      if (customer === undefined) return false;
      Object.assign(customer, patch, { updatedAt: clock() });
      if (patch.replacementOffersEnabled === false) {
        for (const offer of state.offers) {
          if (offer.customerId !== customer.id || !["pending", "delivered"].includes(offer.status)) continue;
          offer.status = "declined";
          offer.updatedAt = clock();
          const job = state.refillJobs.find((candidate) => (
            candidate.id === offer.jobId && candidate.currentOfferId === offer.id
          ));
          if (job === undefined) continue;
          job.status = "pending";
          delete job.currentOfferId;
          delete job.leaseOwner;
          delete job.leaseExpiresAt;
          job.updatedAt = clock();
          job.version += 1;
          job.timeline.push({
            type: "offer_declined",
            at: clock(),
            message: `${customer.name} was removed from replacement offers by the operator.`,
            customerId: customer.id,
            offerId: offer.id,
          });
        }
      }
      state.events.push({
        id: randomUUID(),
        type: "customer.updated",
        aggregateId: customer.id,
        occurredAt: clock(),
        data: { customerId: customer.id },
      });
      return true;
    });
    if (!found) return reply.status(404).send({ error: "not_found" });
    return projectCustomerDetail(await options.store.read(), request.params.id)!;
  });

  app.post<{ Params: { id: string } }>("/api/v1/customers/:id/notes", async (request, reply) => {
    const input = customerNoteSchema.parse(request.body);
    const result = await options.store.transaction((state) => {
      const customer = state.customers.find((candidate) => candidate.id === request.params.id);
      if (customer === undefined) return undefined;
      const note = {
        id: randomUUID(),
        customerId: customer.id,
        text: input.text,
        author: "operator" as const,
        createdAt: clock(),
      };
      state.customerNotes.push(note);
      state.events.push({
        id: randomUUID(),
        type: "customer.note_added",
        aggregateId: customer.id,
        occurredAt: clock(),
        data: { customerId: customer.id },
      });
      return { id: note.id, text: note.text, author: note.author, createdAt: note.createdAt };
    });
    return result ?? reply.status(404).send({ error: "not_found" });
  });

  app.get("/api/v1/conversations", async () => (
    projectConversationList(await options.store.read())
  ));

  app.get("/api/v1/operator-snapshot", async () => {
    const state = await options.store.read();
    const conversations = projectConversationList(state);
    const selectedConversation = conversations[0] === undefined
      ? undefined
      : projectConversationDetail(state, conversations[0].id);
    return {
      conversations,
      ...(selectedConversation === undefined ? {} : { selectedConversation }),
      waitlist: projectWaitlist(state),
      activity: projectActivity(state),
      generatedAt: clock(),
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/conversations/:id", async (request, reply) => {
    const detail = projectConversationDetail(await options.store.read(), request.params.id);
    return detail ?? reply.status(404).send({ error: "not_found" });
  });

  app.get("/api/v1/waitlist", async () => (
    projectWaitlist(await options.store.read())
  ));

  app.patch<{ Params: { id: string } }>("/api/v1/waitlist/:id", async (request, reply) => {
    const patch = waitlistPatchSchema.parse(request.body);
    const found = await options.store.transaction((state) => {
      const entry = state.waitlist.find((candidate) => candidate.id === request.params.id);
      if (entry === undefined) return false;
      if (patch.status !== undefined) entry.status = patch.status;
      if (patch.operatorNote !== undefined) {
        if (patch.operatorNote === null || patch.operatorNote === "") delete entry.operatorNote;
        else entry.operatorNote = patch.operatorNote;
      }
      entry.updatedAt = clock();
      state.events.push({
        id: randomUUID(),
        type: "waitlist.updated",
        aggregateId: entry.id,
        occurredAt: clock(),
        data: { customerId: entry.customerId },
      });
      return true;
    });
    if (!found) return reply.status(404).send({ error: "not_found" });
    return projectWaitlist(await options.store.read()).find((entry) => entry.id === request.params.id)!;
  });

  app.get("/api/v1/activity", async () => (
    projectActivity(await options.store.read())
  ));

  app.get<{ Params: { id: string } }>("/api/v1/refill-jobs/:id", async (request, reply) => {
    const state = await options.store.read();
    const job = state.refillJobs.find((candidate) => candidate.id === request.params.id);
    if (job === undefined) return reply.status(404).send({ error: "not_found" });
    const barber = state.barbers.find((candidate) => candidate.id === job.barberId);
    const service = state.services.find((candidate) => candidate.id === job.serviceId);
    const offer = job.currentOfferId === undefined
      ? undefined
      : state.offers.find((candidate) => candidate.id === job.currentOfferId);
    const customer = offer === undefined
      ? undefined
      : state.customers.find((candidate) => candidate.id === offer.customerId);
    return {
      ...job,
      barberName: barber?.name ?? "Unknown barber",
      serviceName: service?.name ?? "Unknown service",
      currentOffer: offer === undefined ? null : {
        id: offer.id,
        status: offer.status,
        channel: offer.channel,
        proposedStartAt: offer.proposedStartAt,
        proposedEndAt: offer.proposedEndAt,
        discountPercent: offer.discountPercent,
        expiresAt: offer.expiresAt,
        customerName: customer?.name ?? "Unknown customer",
      },
    };
  });

  app.post<{ Params: { id: string } }>("/api/v1/refill-jobs/:id/cancel", async (request, reply) => {
    const result = await options.store.transaction((state) => {
      const job = state.refillJobs.find((candidate) => candidate.id === request.params.id);
      if (job === undefined) return undefined;
      if (job.status === "cancelled") return { id: job.id, status: job.status };
      if (["completed", "exhausted", "failed"].includes(job.status)) {
        return { id: job.id, status: job.status };
      }

      const currentOffer = job.currentOfferId === undefined
        ? undefined
        : state.offers.find((offer) => offer.id === job.currentOfferId);
      if (
        currentOffer !== undefined
        && ["pending", "delivered"].includes(currentOffer.status)
      ) {
        currentOffer.status = "expired";
        currentOffer.updatedAt = clock();
      }

      job.status = "cancelled";
      delete job.currentOfferId;
      delete job.leaseOwner;
      delete job.leaseExpiresAt;
      delete job.retryAt;
      job.updatedAt = clock();
      job.version += 1;
      job.timeline.push({
        type: "opening_cancelled",
        at: clock(),
        message: "The operator closed this Open Chair. Standby stopped contacting customers.",
      });
      state.events.push({
        id: randomUUID(),
        type: "refill.cancelled",
        aggregateId: job.id,
        occurredAt: clock(),
      });
      return { id: job.id, status: job.status };
    });
    if (result === undefined) return reply.status(404).send({ error: "not_found" });
    return result;
  });

  app.get("/api/v1/events", async (request, reply) => {
    const query = z.object({ once: z.enum(["true", "false"]).optional() }).parse(request.query);
    const initial = `event: connected\ndata: ${JSON.stringify({ at: clock() })}\n\n`;
    if (query.once === "true") {
      return reply.type("text/event-stream; charset=utf-8").send(initial);
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.write(initial);
    const unsubscribe = options.store.subscribe((state) => {
      const event = state.events.at(-1);
      reply.raw.write(`event: domain\ndata: ${JSON.stringify(event ?? { at: clock() })}\n\n`);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat ${clock()}\n\n`);
    }, 20_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post("/api/v1/demo/reset", async () => {
    const currentTime = clock();
    const current = await options.store.read();
    const reset = createDemoState({
      now: currentTime,
      timezone: current.settings.timezone,
      preservedIdentities: {
        ...(current.customers.find((customer) => customer.id === "josh")?.telegramChatId === undefined
          ? {}
          : { joshTelegramChatId: current.customers.find((customer) => customer.id === "josh")!.telegramChatId! }),
        ...(current.customers.find((customer) => customer.id === "alex")?.telegramChatId === undefined
          ? {}
          : { alexTelegramChatId: current.customers.find((customer) => customer.id === "alex")!.telegramChatId! }),
        ...((current.customers.find((customer) => customer.id === "sarah")?.phone
          ?? options.config.sarahPhone) === undefined
          ? {}
          : { sarahPhone: (current.customers.find((customer) => customer.id === "sarah")?.phone
            ?? options.config.sarahPhone)! }),
      },
    });
    reset.backboardThreads = current.backboardThreads;
    reset.processedEvents = current.processedEvents;
    await options.store.replace(reset);
    return { status: "reset", demoDate: getDemoDate(currentTime, current.settings.timezone) };
  });

  return app;
}
