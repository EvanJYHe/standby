import { describe, expect, it } from "vitest";

import { StandbyEngine } from "../../domain/engine.js";
import { InMemoryStore } from "../../domain/store.js";
import { createDemoState } from "../seed.js";
import { SchedulingToolbox } from "./scheduling-tools.js";

const now = "2026-07-18T16:00:00.000Z";
const timezone = "America/Toronto";

describe("SchedulingToolbox", () => {
  it("never exposes a model-supplied customer identifier in mutation schemas", () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);

    expect(JSON.stringify(toolbox.definitions)).not.toContain("customer_id");
    expect(toolbox.definitions.map((tool) => tool.function.name)).toEqual(expect.arrayContaining([
      "get_availability",
      "get_my_appointments",
      "book_appointment",
      "cancel_appointment",
      "reschedule_appointment",
      "respond_to_offer",
      "get_shop_info",
    ]));
  });

  it("binds mutations to the authenticated actor even when an appointment id is known", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);

    const result = await toolbox.execute(
      "cancel_appointment",
      { appointment_id: "josh-appt" },
      { provider: "telegram", customerId: "alex" },
    );

    expect(result).toMatchObject({ type: "error", code: "FORBIDDEN" });
    expect((await store.read()).appointments.find((appointment) => appointment.id === "josh-appt")?.status)
      .toBe("confirmed");
  });

  it("uses the actor for reads and enforces confirmation for bookings", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);

    const appointments = await toolbox.execute(
      "get_my_appointments",
      {},
      { provider: "telegram", customerId: "sarah" },
    );
    expect(appointments).toMatchObject({
      appointments: expect.arrayContaining([
        expect.objectContaining({ id: "sarah-appt", customerName: "Sarah" }),
      ]),
    });

    const availability = await toolbox.execute(
      "get_availability",
      {
        date: "2026-07-20",
        service_id: "haircut",
        include_alternates: true,
      },
      { provider: "telegram", customerId: "alex" },
    );
    const [freeSlot] = (availability as {
      slots: Array<{ barberId: string; startAt: string }>;
    }).slots;
    expect(freeSlot).toBeDefined();

    const proposed = await toolbox.execute(
      "book_appointment",
      {
        barber_id: freeSlot!.barberId,
        service_id: "haircut",
        start_at: freeSlot!.startAt,
        confirmed: false,
      },
      { provider: "telegram", customerId: "alex" },
    );
    expect(proposed).toMatchObject({ type: "confirmation_required" });
  });

  it("returns qualified alternate-barber availability and deterministic shop answers", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);

    const availability = await toolbox.execute(
      "get_availability",
      {
        date: "2026-07-20",
        service_id: "haircut",
        barber_id: "jeremy",
        include_alternates: true,
      },
      { provider: "telegram", customerId: "alex" },
    );
    expect(availability).toMatchObject({
      slots: expect.arrayContaining([expect.objectContaining({ barberName: "Maya" })]),
    });

    const weekend = await toolbox.execute(
      "get_availability",
      {
        date: "2026-07-25",
        service_id: "haircut",
        barber_id: "jeremy",
        include_alternates: true,
      },
      { provider: "telegram", customerId: "alex" },
    );
    expect(weekend).toMatchObject({
      closed: true,
      slots: [],
      message: "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.",
    });

    const shop = await toolbox.execute(
      "get_shop_info",
      { topic: "hours" },
      { provider: "telegram", customerId: "alex" },
    );
    expect(shop).toMatchObject({ timezone, hours: "Monday to Friday, 9:00 AM to 5:00 PM" });
    expect(shop).toMatchObject({
      barbers: expect.arrayContaining([
        { id: "devon", name: "Devon", serviceIds: ["haircut", "beard"] },
      ]),
    });
  });

  it("resolves spoken barber names and close transcription matches instead of returning false zero availability", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);

    const jeremy = await toolbox.execute(
      "get_availability",
      { date: "2026-07-20", service_id: "fade", barber_id: "Jeremy", include_alternates: false },
      { provider: "elevenlabs", customerId: "sarah" },
    );
    expect(jeremy).toMatchObject({
      slots: expect.arrayContaining([expect.objectContaining({ barberId: "jeremy" })]),
    });

    const devin = await toolbox.execute(
      "get_availability",
      { date: "2026-07-20", service_id: "haircut", barber_id: "Devin", include_alternates: false },
      { provider: "elevenlabs", customerId: "sarah" },
    );
    expect(devin).toMatchObject({
      slots: expect.arrayContaining([expect.objectContaining({ barberId: "devon" })]),
    });

    const unknown = await toolbox.execute(
      "get_availability",
      { date: "2026-07-20", service_id: "haircut", barber_id: "Nobody", include_alternates: false },
      { provider: "elevenlabs", customerId: "sarah" },
    );
    expect(unknown).toMatchObject({ type: "error", code: "NOT_FOUND" });
  });
});
