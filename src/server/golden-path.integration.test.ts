import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { StandbyEngine } from "../domain/engine.js";
import { InMemoryStore } from "../domain/store.js";
import { RefillWorker, type OfferDelivery, type OfferSender } from "../domain/worker.js";
import { createDemoState } from "./seed.js";

describe("Standby golden path", () => {
  it("moves Sarah into Josh's opening, then fills Sarah's opening with Alex", async () => {
    const timezone = "America/Toronto";
    const store = new InMemoryStore(createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone,
      preservedIdentities: {
        joshTelegramChatId: "1001",
        alexTelegramChatId: "2002",
        sarahPhone: "+14165550101",
      },
    }));
    const engine = new StandbyEngine(store);
    const deliveries: OfferDelivery[] = [];
    const sender: OfferSender = {
      send: async (delivery) => {
        deliveries.push(delivery);
        return { providerMessageId: `provider-${delivery.offer.id}` };
      },
    };
    let offerSequence = 0;
    const worker = new RefillWorker(store, sender, {
      workerId: "golden-path-worker",
      idFactory: () => `offer-${++offerSequence}`,
    });

    await engine.cancel({
      actor: { provider: "telegram", customerId: "josh" },
      appointmentId: "josh-appt",
      now: "2026-07-20T16:00:00.000Z",
    });
    await worker.runOnce("2026-07-20T16:00:05.000Z");
    expect(deliveries[0]).toMatchObject({
      customer: { id: "sarah" },
      offer: { candidateKind: "move_earlier", channel: "voice" },
    });

    const acceptedVoiceOffer = await engine.respondToOffer({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      offerId: deliveries[0]!.offer.id,
      response: "accept",
      confirmed: true,
      now: "2026-07-20T16:05:00.000Z",
    });
    expect(acceptedVoiceOffer).toMatchObject({ type: "committed", operation: "accept_offer" });
    await worker.runOnce("2026-07-20T16:05:05.000Z");
    expect(deliveries[1]).toMatchObject({
      customer: { id: "alex" },
      offer: { candidateKind: "waitlist", channel: "telegram" },
    });

    await engine.respondToOffer({
      actor: { provider: "telegram", customerId: "alex" },
      offerId: deliveries[1]!.offer.id,
      response: "accept",
      confirmed: true,
      now: "2026-07-20T16:05:30.000Z",
    });

    const state = await store.read();
    const localHour = (iso: string) => DateTime.fromISO(iso).setZone(timezone).hour;
    expect(state.appointments.find((appointment) => appointment.id === "sarah-appt")).toMatchObject({
      customerId: "sarah",
      status: "confirmed",
    });
    expect(localHour(state.appointments.find((appointment) => appointment.id === "sarah-appt")!.startAt)).toBe(13);
    const alex = state.appointments.find(
      (appointment) => appointment.customerId === "alex"
        && appointment.status === "confirmed"
        && DateTime.fromISO(appointment.startAt).setZone(timezone).toISODate() === "2026-07-20",
    );
    expect(alex).toBeDefined();
    expect(localHour(alex!.startAt)).toBe(14);
    expect(state.refillJobs.filter((job) => job.status === "completed" && !job.id.startsWith("demo-"))).toHaveLength(2);
  });
});
