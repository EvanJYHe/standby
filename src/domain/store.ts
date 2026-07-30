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
} from "./types.js";

export interface StandbyState {
  customers: Customer[];
  barbers: Barber[];
  services: Service[];
  appointments: Appointment[];
  waitlist: WaitlistEntry[];
  refillJobs: RefillJob[];
  offers: OutreachOffer[];
  processedEvents: ProcessedProviderEvent[];
  backboardThreads: BackboardThreadMapping[];
  conversations: Conversation[];
  conversationEvents: ConversationEvent[];
  customerNotes: CustomerNote[];
  events: CalendarEvent[];
  settings: SchedulingSettings;
}

export type StateListener = (state: StandbyState) => void;

export interface StandbyStore {
  read(): Promise<StandbyState>;
  transaction<T>(operation: (state: StandbyState) => T | Promise<T>): Promise<T>;
  replace(state: StandbyState): Promise<void>;
  subscribe(listener: StateListener): () => void;
}

function validateConfirmedSlotUniqueness(state: StandbyState): void {
  const confirmedSlots = new Set<string>();
  for (const appointment of state.appointments) {
    if (appointment.status !== "confirmed") continue;
    const key = `${appointment.barberId}:${appointment.startAt}`;
    if (confirmedSlots.has(key)) {
      throw new Error(`Confirmed slot collision: ${key}`);
    }
    confirmedSlots.add(key);
  }
}

export class InMemoryStore implements StandbyStore {
  private state: StandbyState;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<StateListener>();

  constructor(initialState: StandbyState) {
    this.state = structuredClone(initialState);
    validateConfirmedSlotUniqueness(this.state);
  }

  async read(): Promise<StandbyState> {
    await this.transactionTail;
    return structuredClone(this.state);
  }

  async transaction<T>(operation: (state: StandbyState) => T | Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const draft = structuredClone(this.state);
      const result = await operation(draft);
      validateConfirmedSlotUniqueness(draft);
      this.state = draft;
      const snapshot = structuredClone(this.state);
      for (const listener of this.listeners) listener(snapshot);
      return structuredClone(result);
    } finally {
      release?.();
    }
  }

  async replace(state: StandbyState): Promise<void> {
    await this.transaction((draft) => {
      Object.assign(draft, structuredClone(state));
    });
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
