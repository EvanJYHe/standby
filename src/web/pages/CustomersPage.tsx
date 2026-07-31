import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

import { Button, EmptyState, cn } from "../components/ui.js";
import type { CustomerBookingState, CustomerDetail, CustomerSummary, OperatorWaitlistEntry, StandbyApi } from "../types.js";

interface CustomersPageProps {
  api: StandbyApi;
  refreshKey: number;
}

const CUSTOMER_LIST_PREVIEW_LIMIT = 12;

function formatDate(value: string): string {
  return DateTime.fromISO(value).setZone("America/Toronto").toFormat("ccc, LLL d · h:mm a");
}

function formatVisitDate(value: string): string {
  return DateTime.fromISO(value).setZone("America/Toronto").toFormat("LLL d, yyyy");
}

function formatWaitlistWindow(entry: OperatorWaitlistEntry): string {
  const start = entry.earliestStart.includes("T")
    ? DateTime.fromISO(entry.earliestStart).setZone("America/Toronto")
    : DateTime.fromISO(`${entry.date}T${entry.earliestStart}`, { zone: "America/Toronto" });
  const end = entry.latestStart.includes("T")
    ? DateTime.fromISO(entry.latestStart).setZone("America/Toronto")
    : DateTime.fromISO(`${entry.date}T${entry.latestStart}`, { zone: "America/Toronto" });
  return `${start.toFormat("ccc, LLL d")} · ${start.toFormat("h:mm a")}–${end.toFormat("h:mm a")}`;
}

const stateStyles: Record<CustomerBookingState, string> = {
  booked: "border-[#c9d2dc] bg-[#eaf0f6] text-[#34465d]",
  waitlisted: "border-[#e8b8ac] bg-landing-coral-soft text-[#a74836]",
  outreach_ready: "border-[#c9d2dc] bg-white text-[#34465d]",
  not_eligible: "border-line bg-[#f2f0ea] text-muted",
};

function BookingStateBadge({ state, label }: { state: CustomerBookingState; label: string }) {
  return (
    <span className={cn(
      "inline-flex shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]",
      stateStyles[state],
    )}>
      {label}
    </span>
  );
}

function customerSchedulingLine(customer: CustomerSummary): string {
  if (customer.bookingState === "booked") {
    return `${formatDate(customer.nextAppointmentAt!)} · ${customer.nextServiceName} with ${customer.nextBarberName}`;
  }
  if (customer.bookingState === "waitlisted") return customer.waitlistRequestSummary ?? "Active scheduling request";
  if (customer.lastVisitAt !== undefined) {
    return `Last visit ${formatVisitDate(customer.lastVisitAt)} · ${customer.visitCount} ${customer.visitCount === 1 ? "visit" : "visits"}`;
  }
  return customer.bookingState === "outreach_ready" ? "Known customer · no upcoming booking" : "No active booking or request";
}

function CustomerList({ customers, selectedId, onSelect }: {
  customers: CustomerSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (customers.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted">No customers match that search.</p>;
  }
  return (
    <div className="divide-y divide-line">
      {customers.map((customer) => (
        <button
          aria-pressed={selectedId === customer.id}
          className={cn(
            "w-full px-4 py-3.5 text-left transition-colors",
            selectedId === customer.id ? "bg-[#eef1f5]" : "hover:bg-white",
          )}
          key={customer.id}
          onClick={() => onSelect(customer.id)}
          type="button"
        >
          <span className="flex items-center justify-between gap-2">
            <strong className="text-sm font-semibold">{customer.name}</strong>
            <BookingStateBadge label={customer.bookingStateLabel} state={customer.bookingState} />
          </span>
          <span className="mt-1.5 block truncate text-[11px] leading-4 text-[#5f665f]">{customerSchedulingLine(customer)}</span>
          <span className="mt-1 block text-[10px] text-muted">{customer.identitySummary}</span>
        </button>
      ))}
    </div>
  );
}

function PreferenceToggle({ label, detail, checked, disabled, onChange }: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5 border-b border-line py-3.5 last:border-b-0">
      <span>
        <strong className="block text-sm font-medium">{label}</strong>
        <span className="mt-1 block text-xs leading-5 text-muted">{detail}</span>
      </span>
      <input
        aria-label={label}
        checked={checked}
        className="mt-0.5 h-4 w-4 accent-standby"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function AppointmentList({ detail, onCancel }: {
  detail: CustomerDetail;
  onCancel: (appointmentId: string) => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = useState<string>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const now = DateTime.now().toUTC();
  const upcoming = detail.appointments.filter((appointment) => (
    appointment.status === "confirmed" && DateTime.fromISO(appointment.startAt).toUTC() >= now
  ));
  const past = detail.appointments.filter((appointment) => !upcoming.some((candidate) => candidate.id === appointment.id));

  const cancel = async (appointmentId: string) => {
    setCancellingId(appointmentId);
    setStatus(undefined);
    try {
      await onCancel(appointmentId);
      setConfirmingId(undefined);
      setStatus("Appointment cancelled.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The appointment could not be cancelled.");
    } finally {
      setCancellingId(undefined);
    }
  };

  const group = (label: string, appointments: CustomerDetail["appointments"], cancellable = false) => (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</span>
      {appointments.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None</p>
      ) : (
        <div className="mt-2 divide-y divide-line rounded-standby border border-line">
          {appointments.map((appointment) => (
            <article className="grid gap-3 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={appointment.id}>
              <div className="min-w-0">
                <strong className="block text-sm font-medium">{appointment.serviceName}</strong>
                <span className="mt-1 block text-xs text-muted">{appointment.barberName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <time className="mr-1 font-mono text-[10px] text-muted">{formatDate(appointment.startAt)}</time>
                {cancellable ? (
                  confirmingId === appointment.id ? (
                    <span className="inline-flex items-center gap-1 rounded-standby border border-[#ead2d2] bg-[#fff9f9] p-1">
                      <button
                        className="h-7 rounded-[6px] px-2 text-xs font-medium text-muted transition-colors hover:bg-white hover:text-ink"
                        disabled={cancellingId === appointment.id}
                        onClick={() => setConfirmingId(undefined)}
                        type="button"
                      >
                        Keep
                      </button>
                      <button
                        className="h-7 rounded-[6px] bg-[#9e3f3f] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#843333] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={cancellingId === appointment.id}
                        onClick={() => void cancel(appointment.id)}
                        type="button"
                      >
                        {cancellingId === appointment.id ? "Cancelling…" : "Confirm cancel"}
                      </button>
                    </span>
                  ) : (
                    <button
                      aria-label={`Cancel ${appointment.serviceName} on ${formatDate(appointment.startAt)}`}
                      className="h-7 rounded-standby border border-transparent px-2 text-xs font-medium text-[#9e3f3f] transition-colors hover:border-[#ead2d2] hover:bg-[#fff8f8]"
                      onClick={() => {
                        setConfirmingId(appointment.id);
                        setStatus(undefined);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  )
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-2">{group("Upcoming", upcoming, true)}{group("Past", past)}</div>
      {status === undefined ? null : (
        <p aria-live="polite" className={cn(
          "mt-3 text-xs",
          status === "Appointment cancelled." ? "text-standby-dark" : "text-[#9e3f3f]",
        )}>{status}</p>
      )}
    </div>
  );
}

function CustomerRecord({ api, detail, saving, onDetailChange, onSavingChange }: {
  api: StandbyApi;
  detail: CustomerDetail;
  saving: string | undefined;
  onDetailChange: (detail: CustomerDetail) => void;
  onSavingChange: (status: string | undefined) => void;
}) {
  const [note, setNote] = useState("");

  const refresh = async () => {
    onDetailChange(await api.getCustomer(detail.id));
  };
  const updatePreference = async (patch: Partial<CustomerDetail["preferences"]>) => {
    onSavingChange("Saving…");
    try {
      await api.patchCustomer(detail.id, patch);
      await refresh();
      onSavingChange("Saved");
    } catch (error) {
      onSavingChange(error instanceof Error ? error.message : "That preference could not be saved.");
    }
  };
  const addNote = async () => {
    const text = note.trim();
    if (text === "") return;
    onSavingChange("Saving note…");
    try {
      await api.addCustomerNote(detail.id, text);
      setNote("");
      await refresh();
      onSavingChange("Saved");
    } catch (error) {
      onSavingChange(error instanceof Error ? error.message : "That note could not be saved.");
    }
  };
  const cancelAppointment = async (appointmentId: string) => {
    onSavingChange("Cancelling appointment…");
    try {
      await api.cancelAppointment(appointmentId);
      await refresh();
      onSavingChange("Appointment cancelled");
    } catch (error) {
      onSavingChange(undefined);
      throw error;
    }
  };

  return (
    <section aria-label={`${detail.name} customer record`} className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 lg:px-7">
        <div>
          <span className="flex items-center gap-2">
            <h3 className="text-xl font-semibold tracking-[-0.02em]">{detail.name}</h3>
            <span className="rounded-full border border-[#c9d2dc] bg-[#eaf0f6] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#34465d]">
              {detail.preferences.contactPreference}
            </span>
          </span>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>Telegram: <strong className="font-normal">{detail.identities.telegram}</strong></span>
            <span>Phone: <strong className="font-normal">{detail.identities.phone}</strong></span>
          </div>
        </div>
        {saving === undefined ? null : <span className="font-mono text-[10px] text-muted">{saving}</span>}
      </header>
      <div className="divide-y divide-line">
        <section className="px-5 py-5 lg:px-7">
          <div className="py-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">Booking</h4>
              <BookingStateBadge label={detail.relationship.bookingStateLabel} state={detail.relationship.bookingState} />
            </div>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Current request</dt>
                <dd className="mt-1 text-sm font-medium">
                  {detail.relationship.bookingState === "booked"
                    ? `${detail.relationship.nextServiceName} · ${detail.relationship.nextBarberName}`
                    : detail.relationship.bookingState === "waitlisted"
                      ? detail.relationship.waitlistRequestSummary
                      : "No active request"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Visits</dt>
                <dd className="mt-1 text-sm font-medium">{detail.relationship.visitCount} {detail.relationship.visitCount === 1 ? "visit" : "visits"}</dd>
                <span className="mt-0.5 block text-xs text-muted">
                  {detail.relationship.lastVisitAt === undefined ? "No visit recorded" : `Last ${formatVisitDate(detail.relationship.lastVisitAt)}`}
                </span>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Usually books</dt>
                <dd className="mt-1 text-sm font-medium">
                  {detail.relationship.usualServiceName === undefined
                    ? "Still learning"
                    : `${detail.relationship.usualServiceName} · ${detail.relationship.usualBarberName ?? "Any barber"}`}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Reaches them by</dt>
                <dd className="mt-1 text-sm font-medium capitalize">{detail.preferences.contactPreference}</dd>
                <span className="mt-0.5 block text-xs text-muted">
                  {detail.relationship.outreachEligible ? "When an opening matches" : "Active requests only"}
                </span>
              </div>
            </dl>
          </div>
        </section>
        <section className="px-5 py-5 lg:px-7">
          <h4 className="text-sm font-semibold">Preferences</h4>
          <div className="mt-2 max-w-2xl">
            <PreferenceToggle
              checked={detail.preferences.replacementOffersEnabled}
              detail="Master switch for cancellation-opening calls and messages. Turning it off also removes any active offer."
              disabled={saving === "Saving…"}
              label="Receive replacement offers"
              onChange={(checked) => void updatePreference({ replacementOffersEnabled: checked })}
            />
            <PreferenceToggle
              checked={detail.preferences.earlierMoveConsent}
              detail="Standby may offer an earlier opening when the same service and barber match."
              disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled}
              label="Offer earlier appointments"
              onChange={(checked) => void updatePreference({ earlierMoveConsent: checked })}
            />
            <PreferenceToggle
              checked={detail.preferences.flexibleBarberPreference}
              detail="Include another qualified barber when the requested barber is unavailable."
              disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled}
              label="Any qualified barber"
              onChange={(checked) => void updatePreference({ flexibleBarberPreference: checked })}
            />
            <PreferenceToggle
              checked={detail.preferences.pastCustomerOptIn}
              detail="Allow vacancy outreach after waitlist and same-day moves have been exhausted."
              disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled}
              label="Past-customer outreach"
              onChange={(checked) => void updatePreference({ pastCustomerOptIn: checked })}
            />
          </div>
        </section>
        <section className="px-5 py-5 lg:px-7">
          <h4 className="text-sm font-semibold">Appointments</h4>
          <div className="mt-4"><AppointmentList detail={detail} onCancel={cancelAppointment} /></div>
        </section>
        <section className="px-5 py-5 lg:px-7">
          <h4 className="text-sm font-semibold">Waitlist</h4>
          {detail.waitlist.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No waitlist entries.</p>
          ) : (
            <div className="mt-3 divide-y divide-line rounded-standby border border-line">
              {detail.waitlist.map((entry) => (
                <article className="flex items-center justify-between gap-4 px-3.5 py-3" key={entry.id}>
                  <div>
                    <strong className="block text-sm font-medium">{entry.serviceName} · {entry.barberName}</strong>
                    <span className="mt-1 block text-xs capitalize text-muted">{entry.status} · {entry.channel}</span>
                  </div>
                  <time className="font-mono text-[10px] text-muted">{formatWaitlistWindow(entry)}</time>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="px-5 py-5 lg:px-7">
          <h4 className="text-sm font-semibold">Private notes</h4>
          <div className="mt-3 flex max-w-2xl gap-2">
            <label className="sr-only" htmlFor="customer-note">New private note</label>
            <textarea
              className="min-h-20 flex-1 resize-none rounded-standby border border-line bg-white px-3 py-2.5 text-sm placeholder:text-[#9fa69f]"
              id="customer-note"
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add useful front-desk context"
              value={note}
            />
            <Button className="self-end" disabled={note.trim() === ""} onClick={() => void addNote()} variant="primary">Add private note</Button>
          </div>
          {detail.notes.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No private notes.</p>
          ) : (
            <ol className="mt-4 max-w-2xl space-y-2">
              {detail.notes.map((item) => (
                <li className="rounded-standby border border-line bg-[#f7f5ef] px-3.5 py-3 text-sm leading-6" key={item.id}>
                  {item.text}
                  <time className="mt-1 block font-mono text-[9px] text-muted">{formatDate(item.createdAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}

export function CustomersPage({ api, refreshKey }: CustomersPageProps) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [filter, setFilter] = useState<"all" | CustomerBookingState>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<CustomerDetail>();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [showAllCustomers, setShowAllCustomers] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getCustomers("").then((results) => {
      if (!active) return;
      setCustomers(results);
      if (results.length === 0) setDetail(undefined);
    });
    return () => { active = false; };
  }, [api, refreshKey]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const statePriority: Record<CustomerBookingState, number> = {
      waitlisted: 0,
      outreach_ready: 1,
      booked: 2,
      not_eligible: 3,
    };
    return customers
      .filter((customer) => (
        (filter === "all" || customer.bookingState === filter)
        && customer.name.toLocaleLowerCase().includes(normalizedQuery)
      ))
      .sort((left, right) => (
        statePriority[left.bookingState] - statePriority[right.bookingState]
        || right.visitCount - left.visitCount
        || left.name.localeCompare(right.name)
      ));
  }, [customers, filter, query]);
  const visibleCustomers = showAllCustomers || query.trim() !== ""
    ? filteredCustomers
    : filteredCustomers.slice(0, CUSTOMER_LIST_PREVIEW_LIMIT);

  useEffect(() => {
    setSelectedId((current) => (
      current !== undefined && filteredCustomers.some((customer) => customer.id === current)
        ? current
        : filteredCustomers[0]?.id
    ));
    if (filteredCustomers.length === 0) setDetail(undefined);
  }, [filteredCustomers]);

  useEffect(() => {
    if (selectedId === undefined) return;
    let active = true;
    setLoadingDetail(true);
    void api.getCustomer(selectedId).then((nextDetail) => {
      if (active) setDetail(nextDetail);
    }).finally(() => {
      if (active) setLoadingDetail(false);
    });
    return () => { active = false; };
  }, [api, refreshKey, selectedId]);

  const funnel = [
    { id: "all" as const, label: "All customers", value: customers.length },
    { id: "booked" as const, label: "Booked", value: customers.filter((customer) => customer.bookingState === "booked").length },
    { id: "waitlisted" as const, label: "Waitlisted", value: customers.filter((customer) => customer.bookingState === "waitlisted").length },
    { id: "outreach_ready" as const, label: "Ready to contact", value: customers.filter((customer) => customer.bookingState === "outreach_ready").length },
  ];

  return (
    <section className="mx-auto max-w-[1760px]">
      <div className="mb-4 px-1 py-2">
        <h2 className="text-[32px] font-semibold tracking-[-0.05em]">Customer intelligence</h2>
        <p className="mt-1 text-sm text-muted">Every relationship, preference, and booking signal in one place.</p>
      </div>
      <div>
        <div className="mx-auto max-w-7xl">
          <div className="grid overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel sm:grid-cols-2 lg:grid-cols-4">
            {funnel.map((item, index) => (
              <button
                aria-label={`${item.label} ${item.value}`}
                aria-pressed={filter === item.id}
                className={cn(
                  "group min-h-24 border-line px-4 py-4 text-left transition-colors sm:px-5",
                  index > 0 ? "border-t sm:border-t-0 sm:border-l" : "",
                  index === 2 ? "sm:border-l-0 lg:border-l" : "",
                  filter === item.id ? "bg-landing-coral-soft" : "bg-white hover:bg-[#fff7f4]",
                )}
                key={item.id}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{item.label}</span>
                <strong className="mt-2 block text-3xl font-semibold tracking-[-0.05em]">{item.value}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-4 grid min-h-[680px] max-w-7xl overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel md:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-line bg-[#f7f5ef]">
            <div className="border-b border-line p-4">
              <label className="sr-only" htmlFor="customer-search">Search customers</label>
              <input
                className="h-9 w-full rounded-standby border border-line bg-white px-3 text-sm placeholder:text-[#9fa69f]"
                id="customer-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customers"
                role="searchbox"
                value={query}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {visibleCustomers.length === filteredCustomers.length
                    ? `${filteredCustomers.length} customer${filteredCustomers.length === 1 ? "" : "s"}`
                    : `Showing ${visibleCustomers.length} of ${filteredCustomers.length}`}
                </span>
                {filter === "all" ? null : (
                  <button className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-[#a74836] transition-colors hover:border-standby hover:bg-landing-coral-soft" onClick={() => setFilter("all")} type="button">Clear filter</button>
                )}
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <CustomerList customers={visibleCustomers} onSelect={setSelectedId} selectedId={selectedId} />
              {query.trim() !== "" || filteredCustomers.length <= CUSTOMER_LIST_PREVIEW_LIMIT ? null : (
                <button
                  className="w-full border-t border-line px-4 py-3 text-xs font-medium text-standby-dark hover:bg-[#edf4ef]"
                  onClick={() => setShowAllCustomers((current) => !current)}
                  type="button"
                >
                  {showAllCustomers ? "Show fewer customers" : `Show all ${filteredCustomers.length} customers`}
                </button>
              )}
            </div>
          </aside>
          {loadingDetail ? (
            <div className="m-6 animate-pulse rounded-xl bg-[#f0eee8]" />
          ) : detail === undefined ? (
            <EmptyState detail="Choose a customer to view their scheduling record." title="No customer selected" />
          ) : (
            <CustomerRecord
              api={api}
              detail={detail}
              onDetailChange={setDetail}
              onSavingChange={setSaving}
              saving={saving}
            />
          )}
        </div>
      </div>
    </section>
  );
}
