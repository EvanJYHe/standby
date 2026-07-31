import type {
  ActivityItem,
  AppointmentInput,
  AvailabilityResponse,
  CalendarResponse,
  ConversationDetail,
  ConversationSummary,
  CustomerDetail,
  CustomerNote,
  CustomerSummary,
  CustomerWorkspaceSnapshot,
  GoogleCalendarOAuthConfig,
  OperationResult,
  OperatorWaitlistEntry,
  OperatorSnapshot,
  StandbyApi,
  SchedulingSettings,
} from "./types.js";

export class StandbyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StandbyApiError";
  }
}

const pendingReads = new Map<string, Promise<unknown>>();

async function performRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    if (text !== "") {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new StandbyApiError("Standby received an unreadable response.", response.status);
      }
    }
    if (!response.ok) {
      throw new StandbyApiError(
        typeof payload.message === "string" ? payload.message : `Standby request failed (${response.status}).`,
        response.status,
        typeof payload.code === "string" ? payload.code : undefined,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new StandbyApiError("Standby took too long to respond. Please try again.", 408, "TIMEOUT");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  if (method !== "GET" || init?.body !== undefined) return performRequest<T>(url, init);
  const pending = pendingReads.get(url);
  if (pending !== undefined) return pending as Promise<T>;
  const next = performRequest<T>(url, init).finally(() => pendingReads.delete(url));
  pendingReads.set(url, next);
  return next;
}

export const defaultApi: StandbyApi = {
  getGoogleCalendarOAuthConfig: () => request<GoogleCalendarOAuthConfig>(
    "/api/v1/integrations/google/config",
  ),
  getCalendar: (date) => request<CalendarResponse>(`/api/v1/calendar?date=${encodeURIComponent(date)}`),
  getCalendarRange: (start, end) => request<CalendarResponse>(
    `/api/v1/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  ),
  getAvailability: (input) => {
    const query = new URLSearchParams({ date: input.date, serviceId: input.serviceId });
    if (input.barberId !== undefined) query.set("barberId", input.barberId);
    if (input.includeAlternates !== undefined) query.set("includeAlternates", String(input.includeAlternates));
    return request<AvailabilityResponse>(`/api/v1/availability?${query.toString()}`);
  },
  getSettings: () => request<SchedulingSettings>("/api/v1/settings"),
  patchSettings: (patch) => request<SchedulingSettings>("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  resetDemo: () => request<{ status: string; demoDate: string }>("/api/v1/demo/reset", {
    method: "POST",
  }),
  getCustomers: (query) => request<CustomerSummary[]>(
    `/api/v1/customers?q=${encodeURIComponent(query)}`,
  ),
  getCustomerWorkspace: (selectedId) => {
    const query = selectedId === undefined ? "" : `?selectedId=${encodeURIComponent(selectedId)}`;
    return request<CustomerWorkspaceSnapshot>(`/api/v1/customer-workspace${query}`);
  },
  createCustomer: (input) => request<CustomerSummary>("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  getCustomer: (id) => request<CustomerDetail>(
    `/api/v1/customers/${encodeURIComponent(id)}`,
  ),
  patchCustomer: (id, patch) => request<CustomerDetail>(
    `/api/v1/customers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  ),
  addCustomerNote: (id, text) => request<CustomerNote>(
    `/api/v1/customers/${encodeURIComponent(id)}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  ),
  getConversations: () => request<ConversationSummary[]>("/api/v1/conversations"),
  getOperatorSnapshot: () => request<OperatorSnapshot>("/api/v1/operator-snapshot"),
  getConversation: (id) => request<ConversationDetail>(
    `/api/v1/conversations/${encodeURIComponent(id)}`,
  ),
  getWaitlist: () => request<OperatorWaitlistEntry[]>("/api/v1/waitlist"),
  patchWaitlist: (id, patch) => request<OperatorWaitlistEntry>(
    `/api/v1/waitlist/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  ),
  getActivity: () => request<ActivityItem[]>("/api/v1/activity"),
  bookAppointment: (input: AppointmentInput) => request<OperationResult>("/api/v1/appointments", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  rescheduleAppointment: (id, input) => request<OperationResult>(
    `/api/v1/appointments/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  ),
  cancelAppointment: (id) => request<OperationResult>(
    `/api/v1/appointments/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  ),
  cancelRefillJob: (id) => request<{ id: string; status: string }>(
    `/api/v1/refill-jobs/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  ),
};
