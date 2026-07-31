import type { ClientSession, Collection, Db, Document } from "mongodb";
import { MongoClient } from "mongodb";

import type { StandbyState, StandbyStore, StateListener } from "../domain/store.js";
import type {
  Appointment,
  BackboardThreadMapping,
  Barber,
  CalendarEvent,
  Conversation,
  ConversationEvent,
  Customer,
  CustomerNote,
  OutreachOffer,
  ProcessedProviderEvent,
  RefillJob,
  SchedulingSettings,
  Service,
  WaitlistEntry,
} from "../domain/types.js";

type StringIdDocument = Document & { _id: string };

const collectionNames = {
  customers: "customers",
  barbers: "barbers",
  services: "services",
  appointments: "appointments",
  waitlist: "waitlist_entries",
  refillJobs: "refill_jobs",
  offers: "outreach_offers",
  processedEvents: "processed_provider_events",
  backboardThreads: "backboard_thread_mappings",
  conversations: "conversations",
  conversationEvents: "conversation_events",
  customerNotes: "customer_notes",
  events: "calendar_events",
  settings: "shop_settings",
} as const;

function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function documentFor<T extends { id: string }>(value: T): StringIdDocument {
  return { _id: value.id, ...withoutUndefined(value) };
}

function offerDocument(value: OutreachOffer): StringIdDocument {
  return {
    ...documentFor(value),
    ...(["pending", "delivered"].includes(value.status) ? { pendingKey: value.jobId } : {}),
  };
}

function fromDocument<T>(document: StringIdDocument): T {
  const { _id: _ignored, pendingKey: _pendingKey, ...domain } = document;
  return domain as T;
}

async function replaceCollection<T extends { id: string }>(
  collection: Collection<StringIdDocument>,
  values: T[],
  session: ClientSession,
  mapper: (value: T) => StringIdDocument = documentFor,
): Promise<void> {
  await collection.deleteMany({}, { session });
  if (values.length > 0) {
    await collection.insertMany(values.map(mapper), { session, ordered: true });
  }
}

export class MongoStandbyStore implements StandbyStore {
  private readonly database: Db;
  private readonly listeners = new Set<StateListener>();
  private latestState: StandbyState | undefined;

  constructor(
    private readonly client: MongoClient,
    databaseName = "standby",
  ) {
    this.database = client.db(databaseName);
  }

  async initialize(seedState: StandbyState): Promise<void> {
    await this.ensureIndexes();
    const settingsCount = await this.collection(collectionNames.settings).countDocuments({ _id: "shop" });
    if (settingsCount === 0) {
      await this.replace(seedState);
      return;
    }
    this.latestState = await this.readState();
  }

  async ensureIndexes(): Promise<void> {
    const customers = this.collection(collectionNames.customers);
    const appointments = this.collection(collectionNames.appointments);
    const offers = this.collection(collectionNames.offers);
    const processedEvents = this.collection(collectionNames.processedEvents);
    const backboardThreads = this.collection(collectionNames.backboardThreads);
    const refillJobs = this.collection(collectionNames.refillJobs);
    const waitlist = this.collection(collectionNames.waitlist);
    const conversations = this.collection(collectionNames.conversations);
    const conversationEvents = this.collection(collectionNames.conversationEvents);
    const customerNotes = this.collection(collectionNames.customerNotes);

    await Promise.all([
      customers.createIndex(
        { telegramChatId: 1 },
        {
          name: "unique_telegram_chat",
          unique: true,
          partialFilterExpression: { telegramChatId: { $type: "string" } },
        },
      ),
      customers.createIndex(
        { phone: 1 },
        {
          name: "unique_normalized_phone",
          unique: true,
          partialFilterExpression: { phone: { $type: "string" } },
        },
      ),
      appointments.createIndex(
        { barberId: 1, startAt: 1 },
        {
          name: "one_confirmed_barber_start",
          unique: true,
          partialFilterExpression: { status: "confirmed" },
        },
      ),
      appointments.createIndex(
        { customerId: 1, startAt: 1 },
        { name: "customer_appointments" },
      ),
      offers.createIndex(
        { pendingKey: 1 },
        {
          name: "one_pending_offer_per_job",
          unique: true,
          partialFilterExpression: { pendingKey: { $type: "string" } },
        },
      ),
      offers.createIndex(
        { customerId: 1, status: 1, expiresAt: 1 },
        { name: "customer_offer_lookup" },
      ),
      processedEvents.createIndex(
        { provider: 1, eventId: 1 },
        { name: "provider_event_idempotency", unique: true },
      ),
      backboardThreads.createIndex(
        { customerId: 1 },
        { name: "one_backboard_thread_per_customer", unique: true },
      ),
      backboardThreads.createIndex(
        { threadId: 1 },
        { name: "unique_backboard_thread", unique: true },
      ),
      refillJobs.createIndex(
        { sourceAppointmentId: 1, slotStartAt: 1 },
        { name: "refill_job_idempotency", unique: true },
      ),
      refillJobs.createIndex(
        { status: 1, leaseExpiresAt: 1, retryAt: 1 },
        { name: "worker_lease_queue" },
      ),
      waitlist.createIndex(
        { status: 1, serviceId: 1, barberId: 1, date: 1 },
        { name: "waitlist_candidate_lookup" },
      ),
      conversations.createIndex(
        { channel: 1, providerConversationId: 1 },
        { name: "provider_conversation_identity", unique: true },
      ),
      conversations.createIndex(
        { customerId: 1, updatedAt: -1 },
        { name: "customer_conversations" },
      ),
      conversationEvents.createIndex(
        { conversationId: 1, providerEventId: 1 },
        {
          name: "conversation_event_identity",
          unique: true,
          partialFilterExpression: { providerEventId: { $type: "string" } },
        },
      ),
      conversationEvents.createIndex(
        { conversationId: 1, occurredAt: 1 },
        { name: "conversation_event_timeline" },
      ),
      customerNotes.createIndex(
        { customerId: 1, createdAt: -1 },
        { name: "customer_notes" },
      ),
    ]);
  }

  async read(): Promise<StandbyState> {
    if (this.latestState === undefined) {
      throw new Error("MongoStandbyStore must be initialized before reading state.");
    }
    return structuredClone(this.latestState);
  }

  async transaction<T>(operation: (state: StandbyState) => T | Promise<T>): Promise<T> {
    const session = this.client.startSession();
    let result: T | undefined;
    let committedState: StandbyState | undefined;
    try {
      await session.withTransaction(async () => {
        const state = await this.readState(session);
        result = await operation(state);
        await this.writeState(state, session);
        committedState = state;
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
    } finally {
      await session.endSession();
    }
    if (committedState !== undefined) this.publish(committedState);
    return structuredClone(result as T);
  }

  async replace(state: StandbyState): Promise<void> {
    const replacement = structuredClone(state);
    const session = this.client.startSession();
    try {
      await session.withTransaction(
        () => this.writeState(replacement, session),
        { writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    this.publish(replacement);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private collection(name: string): Collection<StringIdDocument> {
    return this.database.collection<StringIdDocument>(name);
  }

  private publish(state: StandbyState): void {
    this.latestState = structuredClone(state);
    for (const listener of this.listeners) listener(structuredClone(this.latestState));
  }

  private async readState(session?: ClientSession): Promise<StandbyState> {
    const findOptions = session === undefined ? {} : { session };
    const assemble = (
      customers: StringIdDocument[],
      barbers: StringIdDocument[],
      services: StringIdDocument[],
      appointments: StringIdDocument[],
      waitlist: StringIdDocument[],
      refillJobs: StringIdDocument[],
      offers: StringIdDocument[],
      processedEvents: StringIdDocument[],
      backboardThreads: StringIdDocument[],
      conversations: StringIdDocument[],
      conversationEvents: StringIdDocument[],
      customerNotes: StringIdDocument[],
      events: StringIdDocument[],
      settingsDocument: StringIdDocument | null,
    ): StandbyState => {
      if (settingsDocument === null) {
        throw new Error("Standby shop settings have not been initialized.");
      }
      const { _id: _settingsId, ...settings } = settingsDocument;
      return {
        customers: customers.map(fromDocument<Customer>),
        barbers: barbers.map(fromDocument<Barber>),
        services: services.map(fromDocument<Service>),
        appointments: appointments.map(fromDocument<Appointment>),
        waitlist: waitlist.map(fromDocument<WaitlistEntry>),
        refillJobs: refillJobs.map(fromDocument<RefillJob>),
        offers: offers.map(fromDocument<OutreachOffer>),
        processedEvents: processedEvents.map(fromDocument<ProcessedProviderEvent>),
        backboardThreads: backboardThreads.map(fromDocument<BackboardThreadMapping>),
        conversations: conversations.map(fromDocument<Conversation>),
        conversationEvents: conversationEvents.map(fromDocument<ConversationEvent>),
        customerNotes: customerNotes.map(fromDocument<CustomerNote>),
        events: events.map(fromDocument<CalendarEvent>),
        settings: settings as unknown as SchedulingSettings,
      };
    };

    const reads = [
      () => this.collection(collectionNames.customers).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.barbers).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.services).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.appointments).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.waitlist).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.refillJobs).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.offers).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.processedEvents).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.backboardThreads).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.conversations).find({}, findOptions).toArray(),
      () => this.collection(collectionNames.conversationEvents).find({}, findOptions).sort({ occurredAt: 1 }).toArray(),
      () => this.collection(collectionNames.customerNotes).find({}, findOptions).sort({ createdAt: 1 }).toArray(),
      () => this.collection(collectionNames.events).find({}, findOptions).sort({ occurredAt: 1 }).toArray(),
      () => this.collection(collectionNames.settings).findOne({ _id: "shop" }, findOptions),
    ] as const;

    if (session === undefined) {
      return assemble(...await Promise.all(reads.map((read) => read())) as Parameters<typeof assemble>);
    }

    // The MongoDB driver forbids parallel operations on one transaction session.
    const results: unknown[] = [];
    for (const read of reads) results.push(await read());
    return assemble(...results as Parameters<typeof assemble>);
  }

  private async writeState(state: StandbyState, session: ClientSession): Promise<void> {
    await replaceCollection(this.collection(collectionNames.customers), state.customers, session);
    await replaceCollection(this.collection(collectionNames.barbers), state.barbers, session);
    await replaceCollection(this.collection(collectionNames.services), state.services, session);
    await replaceCollection(this.collection(collectionNames.appointments), state.appointments, session);
    await replaceCollection(this.collection(collectionNames.waitlist), state.waitlist, session);
    await replaceCollection(this.collection(collectionNames.refillJobs), state.refillJobs, session);
    await replaceCollection(
      this.collection(collectionNames.offers),
      state.offers,
      session,
      offerDocument,
    );
    await replaceCollection(
      this.collection(collectionNames.processedEvents),
      state.processedEvents,
      session,
    );
    await replaceCollection(
      this.collection(collectionNames.backboardThreads),
      state.backboardThreads,
      session,
    );
    await replaceCollection(
      this.collection(collectionNames.conversations),
      state.conversations,
      session,
    );
    await replaceCollection(
      this.collection(collectionNames.conversationEvents),
      state.conversationEvents,
      session,
    );
    await replaceCollection(
      this.collection(collectionNames.customerNotes),
      state.customerNotes,
      session,
    );
    await replaceCollection(this.collection(collectionNames.events), state.events, session);
    await this.collection(collectionNames.settings).replaceOne(
      { _id: "shop" },
      { _id: "shop", ...withoutUndefined(state.settings) },
      { upsert: true, session },
    );
  }
}
