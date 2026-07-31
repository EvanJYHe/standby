import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";

import { StandbyApiError } from "../api.js";
import { MiniMonth } from "../components/MiniMonth.js";
import { EditIcon, TrashIcon, XIcon } from "../components/icons.js";
import { Button, Drawer, IconButton, Modal, SegmentedControl, cn } from "../components/ui.js";
import { movePeriod, periodLabel, periodRange, type CalendarView } from "../lib/dates.js";
import type {
  ActiveRefill,
  CalendarAppointment,
  CalendarResponse,
  CustomerSummary,
  StandbyApi,
} from "../types.js";

interface CalendarPageProps {
  api: StandbyApi;
  calendar: CalendarResponse | undefined;
  anchorDate: string;
  view: CalendarView;
  barberFilter: string;
  loading: boolean;
  onAnchorDateChange: (date: string) => void;
  onViewChange: (view: CalendarView) => void;
  onBarberFilterChange: (barberId: string) => void;
  onMutated: () => Promise<void>;
}

const pixelsPerHour = 96;
const timelineStartHour = 8;
const timelineEndHour = 24;

function localDate(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toISODate()!;
}

function timeLabel(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toFormat("h:mm a");
}

function minuteOfDay(iso: string, timezone: string): number {
  const value = DateTime.fromISO(iso).setZone(timezone);
  return value.hour * 60 + value.minute;
}

function durationMinutes(startAt: string, endAt: string): number {
  return Math.max(0, DateTime.fromISO(endAt).diff(DateTime.fromISO(startAt), "minutes").minutes);
}

const CALENDAR_SCROLL_KEY = "standby:calendarScroll";

function saveCalendarScroll(top: number): void {
  try {
    sessionStorage.setItem(CALENDAR_SCROLL_KEY, String(Math.round(top)));
  } catch {
    // sessionStorage may be unavailable (private mode / SSR); ignore.
  }
}

function initialScrollTop(_starts: string[], _timezone: string): number {
  try {
    const saved = sessionStorage.getItem(CALENDAR_SCROLL_KEY);
    return saved === null ? 0 : Number(saved) || 0;
  } catch {
    return 0;
  }
}

function cardStyle(startAt: string, endAt: string, timezone: string, startMinutes: number): CSSProperties {
  const top = ((minuteOfDay(startAt, timezone) - startMinutes) / 60) * pixelsPerHour;
  const duration = durationMinutes(startAt, endAt);
  const height = Math.max(32, (duration / 60) * pixelsPerHour - 4);
  return {
    "--card-top": `${top + 2}px`,
    "--card-height": `${height}px`,
  } as CSSProperties;
}

function HourLines({ startHour, endHour }: { startHour: number; endHour: number }) {
  return (
    <>
      {Array.from({ length: endHour - startHour + 1 }, (_, index) => (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-line"
          key={index}
          style={{ top: index * pixelsPerHour }}
        />
      ))}
    </>
  );
}

function AppointmentCard({ appointment, timezone, onOpen, compact = false, style }: {
  appointment: CalendarAppointment;
  timezone: string;
  onOpen: (rect: DOMRect) => void;
  compact?: boolean;
  style: CSSProperties;
}) {
  const density = compact || durationMinutes(appointment.startAt, appointment.endAt) < 45
    ? "compact"
    : "full";
  const tone = appointment.barberId === "maya"
    ? "border-[#ccd5df] border-l-[#53667f] bg-[#f5f8fb] hover:bg-white"
    : appointment.barberId === "devon"
      ? "border-[#ddd4cf] border-l-[#8d7165] bg-[#faf7f5] hover:bg-white"
      : "border-[#e5cec7] border-l-landing-coral bg-[#fff7f4] hover:bg-white";
  return (
    <button
      aria-label={`${appointment.customerName}, ${appointment.serviceName}, ${timeLabel(appointment.startAt, timezone)}`}
      className={cn(
        "calendar-card z-10 overflow-hidden rounded-[8px] border border-l-[3px] text-left text-ink shadow-[0_3px_10px_rgba(16,23,34,0.055)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(16,23,34,0.09)] focus-visible:z-30",
        tone,
        density === "compact" ? "px-2 py-1 text-[11px] leading-4" : "px-2.5 py-1.5 text-xs",
      )}
      data-density={density}
      data-visual="solid"
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
      style={style}
      type="button"
    >
      {density === "compact" ? (
        <>
          <strong className="block truncate font-semibold text-ink">{appointment.customerName} · {appointment.serviceName}</strong>
          <span className="block truncate text-[10px] text-muted">{timeLabel(appointment.startAt, timezone)} · {appointment.barberName}</span>
        </>
      ) : (
        <>
          <strong className="block truncate font-semibold text-ink">{appointment.customerName} · {appointment.serviceName}</strong>
          <span className="mt-0.5 block truncate text-muted">{timeLabel(appointment.startAt, timezone)}–{timeLabel(appointment.endAt, timezone)}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">{appointment.barberName}</span>
        </>
      )}
    </button>
  );
}

function RefillCard({ refill, timezone, onOpen, style }: {
  refill: ActiveRefill;
  timezone: string;
  onOpen: () => void;
  style: CSSProperties;
}) {
  return (
    <button
      aria-label={`${refill.customerState} Open refill timeline`}
      className="calendar-card z-20 overflow-hidden rounded-[8px] border border-[#e8b8ac] border-l-[3px] border-l-landing-coral bg-landing-coral-soft px-2.5 py-1.5 text-left text-xs text-ink shadow-[0_3px_10px_rgba(145,58,42,0.08)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-[#ffe9e3] hover:shadow-[0_6px_16px_rgba(145,58,42,0.12)]"
      onClick={onOpen}
      style={style}
      type="button"
    >
      <span className="font-semibold text-[#a74836]">Open chair</span>
      <strong className="mt-1 block truncate font-semibold text-ink">{refill.customerState.replace(/\.$/, "")}</strong>
      <span className="mt-0.5 block truncate text-muted">{timeLabel(refill.slotStartAt, timezone)} · {refill.barberName}</span>
    </button>
  );
}

function TimeRuler({ startHour, endHour }: { startHour: number; endHour: number }) {
  return (
    <div aria-hidden="true" className="relative border-r border-line bg-[#f7f5ef]">
      {Array.from({ length: endHour - startHour }, (_, index) => (
        <span
          className={cn(
            "absolute right-3 font-mono text-[10px] text-muted",
            index === 0 ? "translate-y-1.5" : "-translate-y-1/2",
          )}
          key={index}
          style={{ top: index * pixelsPerHour }}
        >
          {DateTime.fromObject({ hour: startHour + index }).toFormat("h a")}
        </span>
      ))}
    </div>
  );
}

function DayCalendar({ calendar, date, barberFilter, onAppointment, onRefill }: {
  calendar: CalendarResponse;
  date: string;
  barberFilter: string;
  onAppointment: (appointment: CalendarAppointment, rect: DOMRect) => void;
  onRefill: (refill: ActiveRefill) => void;
}) {
  const startHour = timelineStartHour;
  const endHour = timelineEndHour;
  const laneHeight = (endHour - startHour) * pixelsPerHour;
  const barbers = barberFilter === "all"
    ? calendar.barbers
    : calendar.barbers.filter((barber) => barber.id === barberFilter);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleStarts = [
    ...calendar.appointments
      .filter((appointment) => appointment.status === "confirmed")
      .filter((appointment) => barbers.some((barber) => barber.id === appointment.barberId))
      .filter((appointment) => localDate(appointment.startAt, calendar.timezone) === date)
      .map((appointment) => appointment.startAt),
    ...calendar.activeRefills
      .filter((refill) => barbers.some((barber) => barber.id === refill.barberId))
      .filter((refill) => localDate(refill.slotStartAt, calendar.timezone) === date)
      .map((refill) => refill.slotStartAt),
  ];
  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = initialScrollTop(visibleStarts, calendar.timezone);
  }, [barberFilter, calendar.timezone, date, visibleStarts.join("|")]);
  return (
    <section aria-label="Day calendar" className="flex h-full min-h-0 flex-col bg-white" data-end-hour={endHour} data-start-hour={startHour}>
      <div
        className="grid min-h-[52px] shrink-0 border-b border-line bg-[#f7f5ef]"
        role="row"
        style={{ gridTemplateColumns: "72px minmax(0, 1fr)" }}
      >
        <div className="border-r border-line" />
        <div aria-label={barberFilter === "all" ? "All barbers" : barbers[0]?.name} className="flex items-center px-4 text-sm font-semibold" role="columnheader">
          {barberFilter === "all" ? "All barbers" : barbers[0]?.name}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="calendar-scroll-region"
        onScroll={(event) => saveCalendarScroll(event.currentTarget.scrollTop)}
        ref={scrollRef}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: "72px minmax(0, 1fr)" }}
        >
          <TimeRuler endHour={endHour} startHour={startHour} />
          <div className="product-calendar-grid relative" style={{ height: laneHeight }}>
              <HourLines endHour={endHour} startHour={startHour} />
              {calendar.appointments
                .filter((appointment) => appointment.status === "confirmed")
                .filter((appointment) => barbers.some((barber) => barber.id === appointment.barberId))
                .filter((appointment) => localDate(appointment.startAt, calendar.timezone) === date)
                .map((appointment) => {
                  const index = Math.max(0, barbers.findIndex((barber) => barber.id === appointment.barberId));
                  const width = barberFilter === "all" ? 96 / Math.max(1, barbers.length) : 96;
                  return (
                  <AppointmentCard
                    appointment={appointment}
                    key={appointment.id}
                    onOpen={(rect) => onAppointment(appointment, rect)}
                    style={{
                      ...cardStyle(appointment.startAt, appointment.endAt, calendar.timezone, startHour * 60),
                      left: `${2 + index * width}%`,
                      width: `${width - 1}%`,
                    }}
                    timezone={calendar.timezone}
                  />
                  );
                })}
              {calendar.activeRefills
                .filter((refill) => barbers.some((barber) => barber.id === refill.barberId))
                .filter((refill) => localDate(refill.slotStartAt, calendar.timezone) === date)
                .map((refill) => {
                  const index = Math.max(0, barbers.findIndex((barber) => barber.id === refill.barberId));
                  const width = barberFilter === "all" ? 96 / Math.max(1, barbers.length) : 96;
                  return (
                  <RefillCard
                    key={refill.id}
                    onOpen={() => onRefill(refill)}
                    refill={refill}
                    style={{
                      ...cardStyle(refill.slotStartAt, refill.slotEndAt, calendar.timezone, startHour * 60),
                      left: `${2 + index * width}%`,
                      width: `${width - 1}%`,
                    }}
                    timezone={calendar.timezone}
                  />
                  );
                })}
          </div>
        </div>
      </div>
    </section>
  );
}

function WeekCalendar({ calendar, dates, barberFilter, onAppointment, onRefill }: {
  calendar: CalendarResponse;
  dates: string[];
  barberFilter: string;
  onAppointment: (appointment: CalendarAppointment, rect: DOMRect) => void;
  onRefill: (refill: ActiveRefill) => void;
}) {
  const startHour = timelineStartHour;
  const endHour = timelineEndHour;
  const laneHeight = (endHour - startHour) * pixelsPerHour;
  const visibleBarbers = barberFilter === "all"
    ? calendar.barbers
    : calendar.barbers.filter((barber) => barber.id === barberFilter);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleStarts = [
    ...calendar.appointments
      .filter((appointment) => appointment.status === "confirmed")
      .filter((appointment) => dates.includes(localDate(appointment.startAt, calendar.timezone)))
      .filter((appointment) => visibleBarbers.some((barber) => barber.id === appointment.barberId))
      .map((appointment) => appointment.startAt),
    ...calendar.activeRefills
      .filter((refill) => dates.includes(localDate(refill.slotStartAt, calendar.timezone)))
      .map((refill) => refill.slotStartAt),
  ];
  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = initialScrollTop(visibleStarts, calendar.timezone);
  }, [barberFilter, calendar.timezone, dates.join("|"), visibleStarts.join("|")]);
  return (
    <section aria-label="Week calendar" className="flex h-full min-h-0 flex-col bg-white" data-end-hour={endHour} data-start-hour={startHour}>
      <div className="grid min-h-[52px] shrink-0 border-b border-line bg-[#f7f5ef]" style={{ gridTemplateColumns: `72px repeat(${dates.length}, minmax(0, 1fr))` }}>
        <div className="border-r border-line" />
        {dates.map((date) => (
          <div className="flex items-center border-r border-line px-3 text-sm font-semibold last:border-r-0" key={date}>
            {DateTime.fromISO(date).toFormat("ccc d")}
          </div>
        ))}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="calendar-scroll-region"
        onScroll={(event) => saveCalendarScroll(event.currentTarget.scrollTop)}
        ref={scrollRef}
      >
        <div className="grid" style={{ gridTemplateColumns: `72px repeat(${dates.length}, minmax(0, 1fr))` }}>
          <TimeRuler endHour={endHour} startHour={startHour} />
          {dates.map((date) => (
            <div className="product-calendar-grid relative border-r border-line last:border-r-0" key={date} style={{ height: laneHeight }}>
              <HourLines endHour={endHour} startHour={startHour} />
              {calendar.appointments
                .filter((appointment) => appointment.status === "confirmed")
                .filter((appointment) => localDate(appointment.startAt, calendar.timezone) === date)
                .filter((appointment) => visibleBarbers.some((barber) => barber.id === appointment.barberId))
                .map((appointment) => {
                  const index = Math.max(0, visibleBarbers.findIndex((barber) => barber.id === appointment.barberId));
                  const width = 94 / visibleBarbers.length;
                  return (
                    <AppointmentCard
                      appointment={appointment}
                      compact
                      key={appointment.id}
                      onOpen={(rect) => onAppointment(appointment, rect)}
                      style={{
                        ...cardStyle(appointment.startAt, appointment.endAt, calendar.timezone, startHour * 60),
                        left: `${3 + index * width}%`,
                        width: `${width - 1}%`,
                      }}
                      timezone={calendar.timezone}
                    />
                  );
                })}
              {calendar.activeRefills
                .filter((refill) => localDate(refill.slotStartAt, calendar.timezone) === date)
                .filter((refill) => visibleBarbers.some((barber) => barber.id === refill.barberId))
                .map((refill) => (
                  <RefillCard
                    key={refill.id}
                    onOpen={() => onRefill(refill)}
                    refill={refill}
                    style={{
                      ...cardStyle(refill.slotStartAt, refill.slotEndAt, calendar.timezone, startHour * 60),
                      left: 5,
                      right: 5,
                    }}
                    timezone={calendar.timezone}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MonthCalendar({ calendar, anchorDate, dates, barberFilter, onSelectDate }: {
  calendar: CalendarResponse;
  anchorDate: string;
  dates: string[];
  barberFilter: string;
  onSelectDate: (date: string) => void;
}) {
  const anchorMonth = DateTime.fromISO(anchorDate).month;
  return (
    <section aria-label="Month calendar" className="overflow-hidden rounded-[12px] border border-line bg-white shadow-[0_10px_28px_rgba(16,23,34,0.06)]">
      <div className="grid grid-cols-7 border-b border-line bg-[#f7f5ef]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div className="border-r border-line px-3 py-2.5 text-xs font-medium text-muted last:border-r-0" key={day}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dates.map((date) => {
          const value = DateTime.fromISO(date);
          const appointments = calendar.appointments
            .filter((appointment) => appointment.status === "confirmed")
            .filter((appointment) => localDate(appointment.startAt, calendar.timezone) === date)
            .filter((appointment) => barberFilter === "all" || appointment.barberId === barberFilter);
          const refills = calendar.activeRefills
            .filter((refill) => localDate(refill.slotStartAt, calendar.timezone) === date)
            .filter((refill) => barberFilter === "all" || refill.barberId === barberFilter);
          const countLabel = `${appointments.length} ${appointments.length === 1 ? "appointment" : "appointments"}`;
          return (
            <button
              aria-label={`Open ${value.toFormat("cccc, LLLL d")}`}
              className={cn(
                "min-h-28 border-b border-r border-line bg-white p-3 text-left transition-colors hover:bg-[#fff7f4]",
                value.month !== anchorMonth && "bg-[#f7f5ef] text-[#a4a8af]",
              )}
              key={date}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span className="flex items-center justify-between text-xs font-medium">
                {value.day}
                {refills.length > 0 ? <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#a74836]">Open</span> : null}
              </span>
              <span className="mt-5 block text-xs text-muted">{countLabel}</span>
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[#eeece6]">
                <span className="block h-full rounded-full bg-landing-coral" style={{ width: `${Math.min(100, appointments.length * 18)}%` }} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RefillDrawer({ api, refill, timezone, onCancelled, onClose }: {
  api: StandbyApi;
  refill: ActiveRefill;
  timezone: string;
  onCancelled: () => Promise<void>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();

  const cancelRefill = async () => {
    setCancelling(true);
    setError(undefined);
    try {
      await api.cancelRefillJob(refill.id);
      onClose();
      await onCancelled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Open Chair could not be closed.");
      setCancelling(false);
    }
  };

  return (
    <Drawer onClose={onClose} title="Refill timeline">
      <div className="rounded-standby border border-[#e8b8ac] bg-landing-coral-soft p-4">
        <span className="text-xs font-semibold text-[#a74836]">Current state</span>
        <strong className="mt-1.5 block text-base">{refill.customerState}</strong>
        <p className="mt-1 text-sm text-[#7c5a53]">{refill.serviceName} with {refill.barberName} · {timeLabel(refill.slotStartAt, timezone)}</p>
      </div>
      <ol className="mt-6 space-y-0">
        {refill.timeline.map((event, index) => (
          <li className="grid grid-cols-[74px_1fr] gap-3" key={`${event.at}-${index}`}>
            <time className="pt-0.5 font-mono text-[10px] text-muted">{DateTime.fromISO(event.at).setZone(timezone).toFormat("h:mm:ss a")}</time>
            <div className="relative border-l border-line pb-6 pl-4 text-sm leading-6">
              {event.message}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 border-t border-line pt-5">
        {confirming ? (
          <div className="rounded-standby border border-[#ead2d2] bg-[#fff9f9] p-3">
            <strong className="block text-sm font-medium">Close this Open Chair?</strong>
            <p className="mt-1 text-xs leading-5 text-muted">Standby will stop calling or messaging people for this opening.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button disabled={cancelling} onClick={() => setConfirming(false)}>Keep open</Button>
              <Button disabled={cancelling} onClick={() => void cancelRefill()} variant="danger">
                {cancelling ? "Closing…" : "Confirm close"}
              </Button>
            </div>
          </div>
        ) : (
          <Button className="w-full" onClick={() => setConfirming(true)} variant="danger">Close Open Chair</Button>
        )}
        {error === undefined ? null : <p aria-live="polite" className="mt-2 text-xs text-[#9e3f3f]">{error}</p>}
      </div>
    </Drawer>
  );
}

const POPOVER_WIDTH = 320;

function popoverPosition(rect: DOMRect): CSSProperties {
  const gap = 10;
  const margin = 8;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  // Prefer placing the card to the left of the event (Google Calendar style).
  let left = rect.left - POPOVER_WIDTH - gap;
  if (left < margin) {
    left = rect.right + gap;
    if (left + POPOVER_WIDTH > vw - margin) left = Math.max(margin, vw - POPOVER_WIDTH - margin);
  }
  const estimatedHeight = 240;
  let top = rect.top;
  if (top + estimatedHeight > vh - margin) top = vh - estimatedHeight - margin;
  if (top < margin) top = margin;
  return { left, top, width: POPOVER_WIDTH };
}

function barberTone(barberId: string): string {
  if (barberId === "maya") return "#53667f";
  if (barberId === "devon") return "#8d7165";
  return "#f36f56";
}

function AppointmentPopover({ appointment, timezone, anchorRect, api, onClose, onEdit, onMutated }: {
  appointment: CalendarAppointment;
  timezone: string;
  anchorRect: DOMRect;
  api: StandbyApi;
  onClose: () => void;
  onEdit: () => void;
  onMutated: () => Promise<void>;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [status, setStatus] = useState<string>();
  const style = useMemo(() => popoverPosition(anchorRect), [anchorRect]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cancel = async () => {
    setStatus("Cancelling…");
    try {
      await api.cancelAppointment(appointment.id);
      await onMutated();
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The appointment could not be cancelled.");
    }
  };

  const longDate = DateTime.fromISO(appointment.startAt).setZone(timezone).toFormat("cccc, LLLL d");
  return (
    <div
      className="fixed inset-0 z-40"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        aria-label="Appointment details"
        aria-modal="true"
        className="event-popover fixed rounded-[14px] border border-line bg-panel p-4 shadow-[0_22px_60px_-16px_rgba(16,23,34,0.36)]"
        role="dialog"
        style={style}
      >
        <div className="-mr-1 -mt-1 flex items-center justify-end gap-0.5">
          <IconButton aria-label="Reschedule appointment" onClick={onEdit} title="Reschedule"><EditIcon /></IconButton>
          {confirmingCancel ? (
            <IconButton aria-label="Confirm cancellation" className="text-[#9e3f3f] hover:bg-[#fbeeee]" onClick={() => void cancel()} title="Confirm cancellation"><TrashIcon /></IconButton>
          ) : (
            <IconButton aria-label="Cancel appointment" onClick={() => setConfirmingCancel(true)} title="Cancel appointment"><TrashIcon /></IconButton>
          )}
          <IconButton aria-label="Close Appointment details" onClick={onClose}><XIcon /></IconButton>
        </div>
        <div className="mt-0.5 flex gap-3">
          <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ backgroundColor: barberTone(appointment.barberId) }} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-6 tracking-[-0.01em]">{appointment.customerName}</h3>
            <p className="text-sm text-muted">{appointment.serviceName}</p>
            <p className="mt-2 text-sm text-ink">{longDate} · {timeLabel(appointment.startAt, timezone)}–{timeLabel(appointment.endAt, timezone)}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">Barber</dt><dd className="font-medium">{appointment.barberName}</dd></div>
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">Status</dt><dd className="font-medium capitalize">{appointment.status}</dd></div>
              {appointment.discountPercent > 0 ? (
                <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">Discount</dt><dd className="font-medium">{appointment.discountPercent}%</dd></div>
              ) : null}
            </dl>
            {confirmingCancel ? <p className="mt-3 text-xs text-[#9e3f3f]">Tap the trash icon again to confirm.</p> : null}
            {status === undefined ? null : <p className="mt-2 text-xs text-muted">{status}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppointmentEditor({ api, calendar, anchorDate, appointment, onClose, onSuccess }: {
  api: StandbyApi;
  calendar: CalendarResponse;
  anchorDate: string;
  appointment?: CalendarAppointment;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState(appointment?.customerId ?? "");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [serviceId, setServiceId] = useState(appointment?.serviceId ?? calendar.services[0]?.id ?? "");
  const [barberId, setBarberId] = useState(appointment?.barberId ?? calendar.barbers[0]?.id ?? "");
  const [date, setDate] = useState(appointment === undefined
    ? anchorDate
    : localDate(appointment.startAt, calendar.timezone));
  const [slots, setSlots] = useState<Array<{ startAt: string; localTime: string }>>([]);
  const [startAt, setStartAt] = useState("");
  const [status, setStatus] = useState("");
  const editing = appointment !== undefined;

  useEffect(() => {
    let active = true;
    void api.getCustomers("").then((result) => {
      if (!active) return;
      setCustomers(result);
      if (!editing && result[0] !== undefined) setCustomerId(result[0].id);
      setStatus("");
    }).catch(() => {
      if (active) setStatus("Customers could not be loaded.");
    });
    return () => { active = false; };
  }, [api, editing]);

  useEffect(() => {
    if (serviceId === "" || barberId === "" || date === "") return;
    let active = true;
    setStartAt("");
    void api.getAvailability({ date, serviceId, barberId }).then((result) => {
      if (!active) return;
      setSlots(result.slots);
      setStatus(result.closed
        ? result.message ?? "We're closed. We're open Monday through Friday from 9:00 AM to 5:00 PM."
        : result.slots.length === 0
          ? "No live times are available for this selection."
          : "");
    }).catch(() => {
      if (active) setStatus("Availability could not be loaded.");
    });
    return () => { active = false; };
  }, [api, barberId, date, serviceId]);

  const missingCustomer = !editing && (addingCustomer ? newCustomerName.trim() === "" : customerId === "");
  const submit = async () => {
    if (startAt === "" || barberId === "" || missingCustomer) return;
    setStatus(editing ? "Moving appointment…" : "Booking appointment…");
    try {
      if (editing) {
        await api.rescheduleAppointment(appointment.id, { barberId, startAt });
      } else {
        const bookingCustomerId = addingCustomer
          ? (await api.createCustomer({ name: newCustomerName.trim() })).id
          : customerId;
        await api.bookAppointment({ customerId: bookingCustomerId, barberId, serviceId, startAt });
      }
      await onSuccess();
      onClose();
    } catch (error) {
      if (error instanceof StandbyApiError && error.status === 409) {
        setStatus(error.message);
        const refreshed = await api.getAvailability({ date, serviceId, barberId }).catch(() => undefined);
        if (refreshed !== undefined) setSlots(refreshed.slots);
        return;
      }
      setStatus(error instanceof Error ? error.message : "The appointment could not be saved.");
    }
  };

  const eligibleBarbers = calendar.barbers.filter((barber) => barber.serviceIds.includes(serviceId));
  return (
    <Modal onClose={onClose} title={editing ? "Reschedule appointment" : "New appointment"}>
      <div className="space-y-4">
        {editing ? (
          <div className="rounded-standby border border-line bg-[#f4f2ec] p-3 text-sm">
            <strong>{appointment.customerName}</strong><span className="text-muted"> · {appointment.serviceName}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Customer
              <select
                className="field-select mt-1.5 h-10 w-full rounded-standby border border-line bg-white pl-3 text-sm"
                onChange={(event) => {
                  if (event.target.value === "__new__") {
                    setAddingCustomer(true);
                    setCustomerId("");
                  } else {
                    setAddingCustomer(false);
                    setCustomerId(event.target.value);
                  }
                }}
                value={addingCustomer ? "__new__" : customerId}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                <option value="__new__">+ Add new customer…</option>
              </select>
            </label>
            {addingCustomer ? (
              <input
                aria-label="New customer name"
                autoFocus
                className="h-10 w-full rounded-standby border border-line bg-white px-3 text-sm placeholder:text-[#9fa69f]"
                onChange={(event) => setNewCustomerName(event.target.value)}
                placeholder="New customer name"
                value={newCustomerName}
              />
            ) : null}
          </div>
        )}
        {!editing ? (
          <label className="block text-sm font-medium">
            Service
            <select className="field-select mt-1.5 h-10 w-full rounded-standby border border-line bg-white pl-3 text-sm" onChange={(event) => setServiceId(event.target.value)} value={serviceId}>
              {calendar.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Barber
            <select className="field-select mt-1.5 h-10 w-full rounded-standby border border-line bg-white pl-3 text-sm" onChange={(event) => setBarberId(event.target.value)} value={barberId}>
              {eligibleBarbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Date
            <input className="mt-1.5 h-10 w-full rounded-standby border border-line bg-white px-3 text-sm" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Time
          <select className="field-select mt-1.5 h-10 w-full rounded-standby border border-line bg-white pl-3 text-sm" onChange={(event) => setStartAt(event.target.value)} value={startAt}>
            <option value="">Select a live opening</option>
            {slots.map((slot) => <option key={slot.startAt} value={slot.startAt}>{slot.localTime}</option>)}
          </select>
        </label>
        {status === "" ? null : <p className={cn("text-sm", status.includes("taken") ? "text-[#a44646]" : "text-muted")}>{status}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button disabled={startAt === "" || missingCustomer} onClick={() => void submit()} variant="primary">
            {editing ? "Confirm new time" : "Confirm appointment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CalendarPage({
  api,
  calendar,
  anchorDate,
  view,
  barberFilter,
  onAnchorDateChange,
  onViewChange,
  onBarberFilterChange,
  onMutated,
}: CalendarPageProps) {
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment>();
  const [anchorRect, setAnchorRect] = useState<DOMRect>();
  const [selectedRefill, setSelectedRefill] = useState<ActiveRefill>();
  const [editor, setEditor] = useState<"new" | "edit">();
  const range = useMemo(() => periodRange(anchorDate, view), [anchorDate, view]);

  const openAppointment = (appointment: CalendarAppointment, rect: DOMRect) => {
    setSelectedAppointment(appointment);
    setAnchorRect(rect);
  };
  const openEditor = () => setEditor("new");
  const selectMonthDate = (date: string) => {
    onAnchorDateChange(date);
    onViewChange("day");
  };

  return (
    <section className="mx-auto flex h-[calc(100vh-116px)] min-h-[620px] max-w-[1760px] flex-col overflow-hidden rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-panel shadow-[0_18px_50px_rgba(16,23,34,0.08)]">
      <div className="shrink-0 border-b border-line bg-panel px-5 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-3 text-[22px] font-semibold tracking-[-0.04em]">Calendar</h2>
            <IconButton aria-label="Previous period" onClick={() => onAnchorDateChange(movePeriod(anchorDate, view, -1))}>‹</IconButton>
            <IconButton aria-label="Next period" onClick={() => onAnchorDateChange(movePeriod(anchorDate, view, 1))}>›</IconButton>
            <strong className="min-w-40 font-landing-serif text-[17px] font-normal italic tracking-[-0.02em]">{periodLabel(anchorDate, view)}</strong>
            <Button className="h-8" onClick={() => onAnchorDateChange(calendar?.demoDate ?? anchorDate)} variant="ghost">Today</Button>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              label="Calendar view"
              onChange={onViewChange}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
              value={view}
            />
            <Button aria-label="New appointment" onClick={openEditor} variant="primary">
              <span aria-hidden="true">+</span>
              New appointment
            </Button>
          </div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)] bg-white max-[900px]:grid-cols-1">
        <aside className="min-h-0 border-r border-line bg-[#f7f5ef] px-4 py-5 max-[900px]:hidden">
          <MiniMonth anchorDate={anchorDate} onSelect={selectMonthDate} />
          <div className="mt-6 border-t border-line pt-5">
            <div className="mb-2 flex items-center">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Barbers</span>
            </div>
            <div className="space-y-1">
              {[{ id: "all", name: "All barbers" }, ...(calendar?.barbers ?? [])].map((barber) => (
                <button
                  aria-pressed={barberFilter === barber.id}
                  className={cn(
                    "flex h-9 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors",
                    barberFilter === barber.id
                      ? "bg-landing-coral-soft font-semibold text-ink"
                      : "text-muted hover:bg-white hover:text-ink",
                  )}
                  key={barber.id}
                  onClick={() => onBarberFilterChange(barber.id)}
                  type="button"
                >
                  <span className={cn("mr-2 h-2 w-2 rounded-full border", barberFilter === barber.id ? "border-standby bg-standby" : "border-[#b9b8b1]")} />
                  {barber.name}
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className={cn("min-h-0 min-w-0", view === "month" ? "overflow-y-auto bg-[#f7f5ef] p-4" : "") }>
          {calendar === undefined ? (
            <div className="min-h-96 animate-pulse border border-line bg-panel" />
          ) : view === "day" ? (
          <DayCalendar
            barberFilter={barberFilter}
            calendar={calendar}
            date={anchorDate}
            onAppointment={openAppointment}
            onRefill={setSelectedRefill}
          />
        ) : view === "week" ? (
          <WeekCalendar
            barberFilter={barberFilter}
            calendar={calendar}
            dates={range.visibleDates}
            onAppointment={openAppointment}
            onRefill={setSelectedRefill}
          />
        ) : (
          <MonthCalendar
            anchorDate={anchorDate}
            barberFilter={barberFilter}
            calendar={calendar}
            dates={range.visibleDates}
            onSelectDate={selectMonthDate}
          />
          )}
        </div>
      </div>
      {selectedAppointment === undefined || anchorRect === undefined || editor === "edit" || calendar === undefined ? null : (
        <AppointmentPopover
          anchorRect={anchorRect}
          api={api}
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(undefined)}
          onEdit={() => setEditor("edit")}
          onMutated={onMutated}
          timezone={calendar.timezone}
        />
      )}
      {selectedRefill === undefined || calendar === undefined ? null : (
        <RefillDrawer
          api={api}
          onCancelled={onMutated}
          onClose={() => setSelectedRefill(undefined)}
          refill={selectedRefill}
          timezone={calendar.timezone}
        />
      )}
      {editor === undefined || calendar === undefined ? null : (
        <AppointmentEditor
          anchorDate={anchorDate}
          api={api}
          calendar={calendar}
          onClose={() => {
            setEditor(undefined);
            if (editor === "edit") setSelectedAppointment(undefined);
          }}
          onSuccess={onMutated}
          {...(editor === "edit" && selectedAppointment !== undefined
            ? { appointment: selectedAppointment }
            : {})}
        />
      )}
    </section>
  );
}
