import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

import {
  CalendarIcon,
  NoteIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  TelegramIcon,
} from "../components/icons.js";
import { Button, EmptyState, cn } from "../components/ui.js";
import type {
  CustomerBookingState,
  CustomerDetail,
  CustomerSummary,
  CustomerWorkspaceSnapshot,
  OperatorWaitlistEntry,
  StandbyApi,
} from "../types.js";

interface CustomersPageProps {
  api: StandbyApi;
  refreshKey: number;
}

type CustomerView = "all" | CustomerBookingState;
type RecordTab = "overview" | "appointments" | "waitlist" | "notes";

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
  return `${start.toFormat("LLL d")} · ${start.toFormat("h:mm a")}–${end.toFormat("h:mm a")}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

const stateStyles: Record<CustomerBookingState, string> = {
  booked: "border-[#ced7e1] bg-[#f3f6f9] text-[#34465d]",
  waitlisted: "border-[#f3b6a7] bg-[#fff3ef] text-[#a74836]",
  outreach_ready: "border-[#cbd4dc] bg-white text-[#34465d]",
  not_eligible: "border-line bg-[#f5f5f3] text-muted",
};

function BookingStateBadge({ state, label }: { state: CustomerBookingState; label: string }) {
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]",
      stateStyles[state],
    )}>
      {label}
    </span>
  );
}

function customerSchedulingLine(customer: CustomerSummary): string {
  if (customer.bookingState === "booked") {
    return `${customer.nextServiceName} · ${customer.nextBarberName} · ${formatDate(customer.nextAppointmentAt!)}`;
  }
  if (customer.bookingState === "waitlisted") return customer.waitlistRequestSummary ?? "Active scheduling request";
  if (customer.bookingState === "outreach_ready") return customer.matchReason;
  return "No active booking or request";
}

function channelLabel(customer: CustomerSummary): string {
  return customer.contactPreference === "voice" ? "Voice" : "Telegram";
}

function PreferenceSwitch({ label, detail, checked, disabled, onChange }: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-t border-line py-3.5 first:border-t-0">
      <div>
        <strong className="block text-[13px] font-medium text-ink">{label}</strong>
        <span className="mt-1 block text-[11px] leading-4 text-muted">{detail}</span>
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-landing-coral/40 disabled:cursor-not-allowed disabled:opacity-40",
          checked ? "border-landing-coral bg-landing-coral" : "border-[#aeb7c1] bg-[#e7ebef]",
        )}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-[17px]" : "translate-x-0.5",
        )} />
      </button>
    </div>
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
  const upcomingIds = new Set(upcoming.map((appointment) => appointment.id));
  const past = detail.appointments.filter((appointment) => !upcomingIds.has(appointment.id));

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
    <section>
      <h5 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</h5>
      {appointments.length === 0 ? (
        <p className="mt-2 rounded-[7px] border border-dashed border-line px-4 py-7 text-center text-xs text-muted">No {label.toLocaleLowerCase()} appointments.</p>
      ) : (
        <div className="mt-2 divide-y divide-line rounded-[7px] border border-line bg-white">
          {appointments.map((appointment) => (
            <article className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={appointment.id}>
              <div className="min-w-0">
                <strong className="block text-[13px] font-medium">{appointment.serviceName}</strong>
                <span className="mt-1 block text-[11px] text-muted">{appointment.barberName} · {formatDate(appointment.startAt)}</span>
              </div>
              {cancellable ? (
                confirmingId === appointment.id ? (
                  <span className="inline-flex items-center gap-1 rounded-[6px] border border-[#ead2d2] bg-[#fff9f9] p-1">
                    <button className="h-7 rounded-[5px] px-2 text-xs font-medium text-muted hover:bg-white hover:text-ink" disabled={cancellingId === appointment.id} onClick={() => setConfirmingId(undefined)} type="button">Keep</button>
                    <button className="h-7 rounded-[5px] bg-[#9e3f3f] px-2.5 text-xs font-medium text-white hover:bg-[#843333] disabled:opacity-50" disabled={cancellingId === appointment.id} onClick={() => void cancel(appointment.id)} type="button">
                      {cancellingId === appointment.id ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  </span>
                ) : (
                  <button
                    aria-label={`Cancel ${appointment.serviceName} on ${formatDate(appointment.startAt)}`}
                    className="h-7 rounded-[5px] px-2 text-xs font-medium text-[#9e3f3f] hover:bg-[#fff5f3]"
                    onClick={() => { setConfirmingId(appointment.id); setStatus(undefined); }}
                    type="button"
                  >
                    Cancel
                  </button>
                )
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div>
      <div className="grid gap-5 xl:grid-cols-2">{group("Upcoming", upcoming, true)}{group("Past", past)}</div>
      {status === undefined ? null : (
        <p aria-live="polite" className={cn("mt-3 text-xs", status === "Appointment cancelled." ? "text-standby-dark" : "text-[#9e3f3f]")}>{status}</p>
      )}
    </div>
  );
}

function CustomerRecord({ api, detail, saving, onDetailChange, onRefresh, onSavingChange }: {
  api: StandbyApi;
  detail: CustomerDetail;
  saving: string | undefined;
  onDetailChange: (detail: CustomerDetail) => void;
  onRefresh: () => Promise<CustomerDetail>;
  onSavingChange: (status: string | undefined) => void;
}) {
  const [tab, setTab] = useState<RecordTab>("overview");
  const [note, setNote] = useState("");

  const updatePreference = async (patch: Partial<CustomerDetail["preferences"]>) => {
    onSavingChange("Saving…");
    try {
      onDetailChange(await api.patchCustomer(detail.id, patch));
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
      const created = await api.addCustomerNote(detail.id, text);
      setNote("");
      onDetailChange({ ...detail, notes: [created, ...detail.notes] });
      onSavingChange("Saved");
    } catch (error) {
      onSavingChange(error instanceof Error ? error.message : "That note could not be saved.");
    }
  };
  const cancelAppointment = async (appointmentId: string) => {
    onSavingChange("Cancelling appointment…");
    try {
      await api.cancelAppointment(appointmentId);
      onDetailChange(await onRefresh());
      onSavingChange("Appointment cancelled");
    } catch (error) {
      onSavingChange(undefined);
      throw error;
    }
  };

  const tabs: Array<{ id: RecordTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "appointments", label: "Appointments", count: detail.appointments.length },
    { id: "waitlist", label: "Waitlist", count: detail.waitlist.length },
    { id: "notes", label: "Notes", count: detail.notes.length },
  ];
  const currentRequest = detail.relationship.bookingState === "booked"
    ? `${detail.relationship.nextServiceName} with ${detail.relationship.nextBarberName}`
    : detail.relationship.bookingState === "waitlisted"
      ? detail.relationship.waitlistRequestSummary
      : "No active request";

  return (
    <section aria-label={`${detail.name} customer record`} className="min-w-0 bg-[#f6f8fa]">
      <header className="border-b border-line bg-white px-5 pb-0 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">{initials(detail.name)}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold tracking-[-0.025em]">{detail.name}</h3>
                <BookingStateBadge label={detail.relationship.bookingStateLabel} state={detail.relationship.bookingState} />
              </div>
              <p className="mt-1 truncate text-[11px] text-muted">
                Phone: {detail.identities.phone} · Telegram: {detail.identities.telegram}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-line bg-white px-2.5 text-xs font-medium hover:bg-[#f6f8fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={detail.identities.phone === "Not linked"} onClick={() => onSavingChange("Voice call queued") } type="button"><PhoneIcon className="h-3.5 w-3.5" />Call</button>
            <button className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-line bg-white px-2.5 text-xs font-medium hover:bg-[#f6f8fa]" onClick={() => setTab("notes")} type="button"><NoteIcon className="h-3.5 w-3.5" />Note</button>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 overflow-x-auto">
          <div aria-label="Customer record sections" className="flex min-w-max" role="tablist">
            {tabs.map((item) => (
              <button
                aria-selected={tab === item.id}
                className={cn(
                  "border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                  tab === item.id ? "border-landing-coral text-ink" : "border-transparent text-muted hover:text-ink",
                )}
                key={item.id}
                onClick={() => setTab(item.id)}
                role="tab"
                type="button"
              >
                {item.label}{item.count === undefined ? "" : ` ${item.count}`}
              </button>
            ))}
          </div>
          {saving === undefined ? null : <span aria-live="polite" className="mb-2.5 shrink-0 font-mono text-[9px] text-muted">{saving}</span>}
        </div>
      </header>

      <div className="p-5">
        {tab === "overview" ? (
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.8fr)]">
            <div className="space-y-4">
              <section className="rounded-[8px] border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Current booking signal</span>
                    <h4 className="mt-2 text-base font-semibold">{currentRequest}</h4>
                    <p className="mt-1.5 text-xs leading-5 text-muted">{detail.relationship.matchReason}</p>
                  </div>
                  <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0 text-landing-coral" />
                </div>
              </section>
              <section className="rounded-[8px] border border-line bg-white p-4">
                <h4 className="text-sm font-semibold">Relationship</h4>
                <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Visits</dt><dd className="mt-1 text-[13px] font-medium">{detail.relationship.visitCount} {detail.relationship.visitCount === 1 ? "visit" : "visits"}</dd></div>
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Last visit</dt><dd className="mt-1 text-[13px] font-medium">{detail.relationship.lastVisitAt === undefined ? "No visit recorded" : formatVisitDate(detail.relationship.lastVisitAt)}</dd></div>
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Usually books</dt><dd className="mt-1 text-[13px] font-medium">{detail.relationship.usualServiceName ?? "Still learning"}</dd></div>
                  <div><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Preferred barber</dt><dd className="mt-1 text-[13px] font-medium">{detail.relationship.usualBarberName ?? "Any barber"}</dd></div>
                </dl>
              </section>
            </div>
            <div className="space-y-4">
              <section className="rounded-[8px] border border-line bg-white p-4">
                <h4 className="text-sm font-semibold">About this customer</h4>
                <dl className="mt-3 divide-y divide-line text-xs">
                  <div className="grid grid-cols-[94px_1fr] gap-3 py-2.5"><dt className="text-muted">Phone</dt><dd className="font-medium">{detail.identities.phone}</dd></div>
                  <div className="grid grid-cols-[94px_1fr] gap-3 py-2.5"><dt className="text-muted">Telegram</dt><dd className="font-medium">{detail.identities.telegram}</dd></div>
                  <div className="grid grid-cols-[94px_1fr] gap-3 py-2.5"><dt className="text-muted">Preferred</dt><dd className="font-medium capitalize">{detail.preferences.contactPreference}</dd></div>
                  <div className="grid grid-cols-[94px_1fr] gap-3 py-2.5"><dt className="text-muted">Outreach</dt><dd className="font-medium">{detail.relationship.outreachEligible ? "Eligible" : "Active requests only"}</dd></div>
                </dl>
              </section>
              <section className="rounded-[8px] border border-line bg-white p-4">
                <h4 className="text-sm font-semibold">Outreach preferences</h4>
                <div className="mt-2">
                  <PreferenceSwitch checked={detail.preferences.replacementOffersEnabled} detail="Cancellation-opening calls and messages." disabled={saving === "Saving…"} label="Replacement offers" onChange={(checked) => void updatePreference({ replacementOffersEnabled: checked })} />
                  <PreferenceSwitch checked={detail.preferences.earlierMoveConsent} detail="Offer an earlier matching appointment." disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled} label="Offer earlier appointments" onChange={(checked) => void updatePreference({ earlierMoveConsent: checked })} />
                  <PreferenceSwitch checked={detail.preferences.flexibleBarberPreference} detail="Include another qualified barber." disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled} label="Any qualified barber" onChange={(checked) => void updatePreference({ flexibleBarberPreference: checked })} />
                  <PreferenceSwitch checked={detail.preferences.pastCustomerOptIn} detail="Allow outreach after the waitlist is exhausted." disabled={saving === "Saving…" || !detail.preferences.replacementOffersEnabled} label="Past-customer outreach" onChange={(checked) => void updatePreference({ pastCustomerOptIn: checked })} />
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {tab === "appointments" ? (
          <section>
            <h4 className="text-base font-semibold">Appointments</h4>
            <p className="mt-1 text-xs text-muted">Upcoming bookings and completed visit history.</p>
            <div className="mt-4"><AppointmentList detail={detail} onCancel={cancelAppointment} /></div>
          </section>
        ) : null}

        {tab === "waitlist" ? (
          <section>
            <h4 className="text-base font-semibold">Waitlist</h4>
            <p className="mt-1 text-xs text-muted">Active and previous requests for a better opening.</p>
            {detail.waitlist.length === 0 ? (
              <p className="mt-4 rounded-[7px] border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No waitlist entries.</p>
            ) : (
              <div className="mt-4 divide-y divide-line rounded-[7px] border border-line bg-white">
                {detail.waitlist.map((entry) => (
                  <article className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5" key={entry.id}>
                    <div><strong className="block text-[13px] font-medium">{entry.serviceName} · {entry.barberName}</strong><span className="mt-1 block text-[11px] capitalize text-muted">{entry.status} · {entry.channel}</span></div>
                    <time className="font-mono text-[10px] text-muted">{formatWaitlistWindow(entry)}</time>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === "notes" ? (
          <section>
            <h4 className="text-base font-semibold">Private notes</h4>
            <p className="mt-1 text-xs text-muted">Front-desk context. Customers never see this.</p>
            <div className="mt-4 flex gap-2">
              <label className="sr-only" htmlFor={`customer-note-${detail.id}`}>New private note</label>
              <textarea className="min-h-20 flex-1 resize-none rounded-[7px] border border-line bg-white px-3 py-2.5 text-sm placeholder:text-[#9fa69f]" id={`customer-note-${detail.id}`} onChange={(event) => setNote(event.target.value)} placeholder="Add useful front-desk context" value={note} />
              <Button className="self-end" disabled={note.trim() === ""} onClick={() => void addNote()} variant="primary">Add note</Button>
            </div>
            {detail.notes.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No private notes.</p>
            ) : (
              <ol className="mt-4 space-y-2">
                {detail.notes.map((item) => (
                  <li className="rounded-[7px] border border-line bg-white px-3.5 py-3 text-sm leading-6" key={item.id}>{item.text}<time className="mt-1 block font-mono text-[9px] text-muted">{formatDate(item.createdAt)}</time></li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function CustomerTable({ customers, selectedId, onSelect }: {
  customers: CustomerSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (customers.length === 0) {
    return <p className="px-5 py-16 text-center text-sm text-muted">No customers match this view.</p>;
  }
  return (
    <div className="min-w-[790px]" role="table" aria-label="Customers">
      <div className="grid grid-cols-[minmax(190px,1.05fr)_125px_minmax(230px,1.35fr)_110px_72px] border-b border-line bg-[#f6f8fa] px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted" role="row">
        <span role="columnheader">Customer</span><span role="columnheader">Status</span><span role="columnheader">Next step</span><span role="columnheader">Last visit</span><span className="text-right" role="columnheader">Visits</span>
      </div>
      <div className="divide-y divide-line">
        {customers.map((customer) => (
          <button
            aria-label={`${customer.name}, ${customer.bookingStateLabel}, ${channelLabel(customer)}, ${customerSchedulingLine(customer)}`}
            aria-pressed={selectedId === customer.id}
            className={cn(
              "relative grid w-full grid-cols-[minmax(190px,1.05fr)_125px_minmax(230px,1.35fr)_110px_72px] items-center px-4 py-3 text-left transition-colors",
              selectedId === customer.id ? "bg-[#fff5f1] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-landing-coral" : "bg-white hover:bg-[#fafbfc]",
            )}
            key={customer.id}
            onClick={() => onSelect(customer.id)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9edf2] text-[10px] font-semibold text-[#435164]">{initials(customer.name)}</span>
              <span className="min-w-0"><strong className="block truncate text-[13px] font-semibold">{customer.name}</strong><span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">{customer.contactPreference === "voice" ? <PhoneIcon className="h-3 w-3" /> : <TelegramIcon className="h-3 w-3" />}{channelLabel(customer)}</span></span>
            </span>
            <span><BookingStateBadge label={customer.bookingStateLabel} state={customer.bookingState} /></span>
            <span className="truncate pr-4 text-[11px] text-[#596576]" title={customerSchedulingLine(customer)}>{customerSchedulingLine(customer)}</span>
            <span className="text-[11px] text-muted">{customer.lastVisitAt === undefined ? "—" : formatVisitDate(customer.lastVisitAt)}</span>
            <span className="text-right text-[12px] font-medium">{customer.visitCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div aria-label="Loading customers" className="grid min-h-[620px] animate-pulse xl:grid-cols-[minmax(700px,1fr)_420px]" role="status">
      <div className="border-r border-line bg-white">
        <div className="border-b border-line p-4"><div className="h-9 w-64 rounded-[6px] bg-[#edf0f3]" /></div>
        <div className="h-9 border-b border-line bg-[#f6f8fa]" />
        {Array.from({ length: 8 }, (_, index) => <div className="flex h-[57px] items-center gap-3 border-b border-line px-4" key={index}><span className="h-8 w-8 rounded-full bg-[#edf0f3]" /><span className="h-3 w-28 rounded bg-[#edf0f3]" /><span className="ml-auto h-3 w-36 rounded bg-[#edf0f3]" /></div>)}
      </div>
      <div className="bg-[#f6f8fa] p-5"><div className="h-16 rounded-[8px] bg-white" /><div className="mt-5 h-48 rounded-[8px] bg-white" /><div className="mt-4 h-40 rounded-[8px] bg-white" /></div>
    </div>
  );
}

function CreateCustomerDialog({ api, onClose, onCreated }: {
  api: StandbyApi;
  onClose: () => void;
  onCreated: (summary: CustomerSummary, detail: CustomerDetail) => void;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"telegram" | "voice">("voice");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (name.trim() === "") return;
    setSubmitting(true);
    setStatus(undefined);
    try {
      const summary = await api.createCustomer({
        name: name.trim(),
        contactPreference: channel,
        ...(channel === "voice" && phone.trim() !== "" ? { phone: phone.trim() } : {}),
      });
      onCreated(summary, await api.getCustomer(summary.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The customer could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section aria-labelledby="create-customer-title" aria-modal="true" className="w-full max-w-md rounded-[10px] border border-line bg-white" role="dialog">
        <header className="border-b border-line px-5 py-4"><h3 className="text-lg font-semibold" id="create-customer-title">Add customer</h3><p className="mt-1 text-xs text-muted">Create a contact Standby can book or call.</p></header>
        <div className="space-y-4 p-5">
          <label className="block text-xs font-medium">Name<input autoFocus className="mt-1.5 h-10 w-full rounded-[6px] border border-line px-3 text-sm" onChange={(event) => setName(event.target.value)} value={name} /></label>
          <label className="block text-xs font-medium">Preferred channel<select className="mt-1.5 h-10 w-full rounded-[6px] border border-line bg-white px-3 text-sm" onChange={(event) => setChannel(event.target.value as "telegram" | "voice")} value={channel}><option value="voice">Voice</option><option value="telegram">Telegram</option></select></label>
          {channel === "voice" ? <label className="block text-xs font-medium">Phone <span className="font-normal text-muted">(optional)</span><input className="mt-1.5 h-10 w-full rounded-[6px] border border-line px-3 text-sm" onChange={(event) => setPhone(event.target.value)} placeholder="+1 416 555 0101" value={phone} /></label> : null}
          {status === undefined ? null : <p className="text-xs text-[#9e3f3f]">{status}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose} variant="secondary">Cancel</Button><Button disabled={name.trim() === "" || submitting} onClick={() => void submit()} variant="primary">{submitting ? "Adding…" : "Add customer"}</Button></footer>
      </section>
    </div>
  );
}

export function CustomersPage({ api, refreshKey }: CustomersPageProps) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [filter, setFilter] = useState<CustomerView>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [details, setDetails] = useState<Record<string, CustomerDetail>>({});
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const [saving, setSaving] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    const loadWorkspace = async (): Promise<CustomerWorkspaceSnapshot> => {
      if (api.getCustomerWorkspace !== undefined) return api.getCustomerWorkspace();
      const nextCustomers = await api.getCustomers("");
      const selectedCustomer = nextCustomers[0] === undefined ? undefined : await api.getCustomer(nextCustomers[0].id);
      return { customers: nextCustomers, ...(selectedCustomer === undefined ? {} : { selectedCustomer }), generatedAt: new Date().toISOString() };
    };
    void loadWorkspace().then((snapshot) => {
      if (!active) return;
      setCustomers(snapshot.customers);
      setSelectedId(snapshot.selectedCustomer?.id ?? snapshot.customers[0]?.id);
      setDetails(snapshot.selectedCustomer === undefined ? {} : { [snapshot.selectedCustomer.id]: snapshot.selectedCustomer });
    }).catch(() => {
      if (active) setLoadError("Customer records could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, refreshKey, reloadKey]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return customers
      .filter((customer) => (
        (filter === "all" || customer.bookingState === filter)
        && customer.name.toLocaleLowerCase().includes(normalizedQuery)
      ))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [customers, filter, query]);

  useEffect(() => {
    if (filteredCustomers.length === 0) {
      setSelectedId(undefined);
      return;
    }
    setSelectedId((current) => current !== undefined && filteredCustomers.some((customer) => customer.id === current) ? current : filteredCustomers[0]?.id);
  }, [filteredCustomers]);

  useEffect(() => {
    if (selectedId === undefined || details[selectedId] !== undefined) return;
    let active = true;
    setLoadingDetailId(selectedId);
    setDetailError(undefined);
    void api.getCustomer(selectedId).then((detail) => {
      if (active) setDetails((current) => ({ ...current, [detail.id]: detail }));
    }).catch(() => {
      if (active) setDetailError("This customer record could not be loaded.");
    }).finally(() => {
      if (active) setLoadingDetailId(undefined);
    });
    return () => { active = false; };
  }, [api, details, selectedId]);

  const updateDetail = (detail: CustomerDetail) => {
    setDetails((current) => ({ ...current, [detail.id]: detail }));
    setCustomers((current) => current.map((customer) => customer.id === detail.id ? {
      ...customer,
      contactPreference: detail.preferences.contactPreference,
      ...detail.relationship,
    } : customer));
  };

  const refreshSelected = async (): Promise<CustomerDetail> => {
    if (selectedId === undefined) throw new Error("No customer selected.");
    if (api.getCustomerWorkspace !== undefined) {
      const snapshot = await api.getCustomerWorkspace(selectedId);
      setCustomers(snapshot.customers);
      if (snapshot.selectedCustomer === undefined) throw new Error("Customer not found.");
      updateDetail(snapshot.selectedCustomer);
      return snapshot.selectedCustomer;
    }
    const [nextCustomers, nextDetail] = await Promise.all([api.getCustomers(""), api.getCustomer(selectedId)]);
    setCustomers(nextCustomers);
    updateDetail(nextDetail);
    return nextDetail;
  };

  const views: Array<{ id: CustomerView; label: string; value: number }> = [
    { id: "all", label: "All customers", value: customers.length },
    { id: "waitlisted", label: "Waitlisted", value: customers.filter((customer) => customer.bookingState === "waitlisted").length },
    { id: "booked", label: "Booked", value: customers.filter((customer) => customer.bookingState === "booked").length },
    { id: "outreach_ready", label: "Ready to contact", value: customers.filter((customer) => customer.bookingState === "outreach_ready").length },
  ];
  const selectedDetail = selectedId === undefined ? undefined : details[selectedId];

  return (
    <section className="mx-auto max-w-[1900px]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4 px-1 py-2">
        <h2 className="text-[32px] font-semibold tracking-[-0.05em]">Customers</h2>
        <Button className="gap-1.5" onClick={() => setCreating(true)} variant="primary"><PlusIcon className="h-4 w-4" />Add customer</Button>
      </header>

      <div className="overflow-hidden rounded-[10px] border border-line bg-white">
        <div className="flex items-end justify-between gap-4 overflow-x-auto border-b border-line px-4 pt-2">
          <div aria-label="Customer views" className="flex min-w-max" role="tablist">
            {views.map((view) => (
              <button aria-label={`${view.label} ${view.value}`} aria-selected={filter === view.id} className={cn("border-b-2 px-3 py-3 text-xs font-medium", filter === view.id ? "border-landing-coral text-ink" : "border-transparent text-muted hover:text-ink")} key={view.id} onClick={() => setFilter(view.id)} role="tab" type="button">
                {view.label}<span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]", filter === view.id ? "bg-[#fff0eb] text-[#a74836]" : "bg-[#eef1f4] text-muted")}>{view.value}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <label className="relative block w-full max-w-[320px]">
            <span className="sr-only">Search customers</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="h-9 w-full rounded-[6px] border border-[#cbd2d9] bg-white pl-9 pr-3 text-sm placeholder:text-[#9fa69f] focus:border-landing-coral focus:outline-none focus:ring-2 focus:ring-landing-coral/15" onChange={(event) => setQuery(event.target.value)} placeholder="Search customers" role="searchbox" value={query} />
          </label>
          <span className="text-[11px] text-muted">Showing {filteredCustomers.length} of {customers.length}</span>
        </div>

        {loading ? <WorkspaceSkeleton /> : loadError !== undefined ? (
          <div className="grid min-h-[520px] place-items-center"><EmptyState detail={loadError} title="Customers unavailable" /><Button className="mx-auto -mt-48" onClick={() => setReloadKey((current) => current + 1)} variant="secondary">Try again</Button></div>
        ) : (
          <div className="grid min-h-[620px] max-h-[820px] xl:grid-cols-[minmax(700px,1fr)_420px]">
            <div className="min-h-0 overflow-auto border-r border-line bg-white">
              <CustomerTable customers={filteredCustomers} onSelect={setSelectedId} selectedId={selectedId} />
            </div>
            <div className="min-h-0 overflow-y-auto bg-[#f6f8fa]">
              {selectedId === undefined ? <EmptyState detail="Choose a view or search for a customer." title="No customer selected" /> : selectedDetail === undefined ? (
                detailError === undefined ? <div className="h-full min-h-[520px] animate-pulse p-5"><div className="h-20 rounded-[8px] bg-white" /><div className="mt-4 h-52 rounded-[8px] bg-white" /></div> : <div className="grid min-h-[520px] place-items-center px-6 text-center"><div><p className="text-sm font-semibold">Customer unavailable</p><p className="mt-1 text-xs text-muted">{detailError}</p><Button className="mt-4" onClick={() => { setDetailError(undefined); setLoadingDetailId(undefined); setDetails((current) => { const next = { ...current }; delete next[selectedId]; return next; }); }} variant="secondary">Try again</Button></div></div>
              ) : (
                <CustomerRecord api={api} detail={selectedDetail} key={selectedDetail.id} onDetailChange={updateDetail} onRefresh={refreshSelected} onSavingChange={setSaving} saving={saving} />
              )}
              {loadingDetailId === undefined ? null : <span className="sr-only" role="status">Loading customer record</span>}
            </div>
          </div>
        )}
      </div>

      {creating ? <CreateCustomerDialog api={api} onClose={() => setCreating(false)} onCreated={(summary, detail) => { setCustomers((current) => [...current, summary]); setDetails((current) => ({ ...current, [detail.id]: detail })); setFilter("all"); setQuery(""); setSelectedId(detail.id); setCreating(false); }} /> : null}
    </section>
  );
}
