import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";

import { StandbyApiError } from "../api.js";
import { MiniMonth } from "../components/MiniMonth.js";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  GoogleCalendarIcon,
  OutlookIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "../components/icons.js";
import { Button, Drawer, IconButton, Modal, SegmentedControl, cn } from "../components/ui.js";
import {
  browserGoogleCalendarIntegration,
  type GoogleCalendarConnectionToken,
  type GoogleCalendarIntegration,
  GoogleCalendarIntegrationError,
  type GoogleCalendarVerification,
} from "../integrations/google-calendar.js";
import { movePeriod, periodLabel, periodRange, type CalendarView } from "../lib/dates.js";
import type {
  ActiveRefill,
  CalendarAppointment,
  CalendarResponse,
  CustomerSummary,
  GoogleCalendarOAuthConfig,
  StandbyApi,
} from "../types.js";

interface CalendarPageProps {
  api: StandbyApi;
  googleCalendarIntegration?: GoogleCalendarIntegration | undefined;
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

type GoogleCalendarConnectionState = GoogleCalendarConnectionToken & GoogleCalendarVerification;

function googleCalendarErrorMessage(error: unknown): string {
  if (error instanceof GoogleCalendarIntegrationError) return error.message;
  return error instanceof Error
    ? error.message
    : "Google Calendar could not be connected. Try again.";
}

const pixelsPerHour = 64;
const timelineStartHour = 8;
const timelineEndHour = 21;

const barberPalette: Record<string, {
  event: string;
  dot: string;
  text: string;
}> = {
  jeremy: { event: "#c4513d", dot: "#c4513d", text: "#ffffff" },
  maya: { event: "#4667a7", dot: "#4667a7", text: "#ffffff" },
  devon: { event: "#367a52", dot: "#367a52", text: "#ffffff" },
};

function barberColor(barberId: string) {
  return barberPalette[barberId] ?? barberPalette.jeremy!;
}

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
  const height = Math.max(24, (duration / 60) * pixelsPerHour - 4);
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
          className="pointer-events-none absolute inset-x-0 border-t border-[#e8eaed]"
          key={index}
          style={{ top: index * pixelsPerHour }}
        />
      ))}
    </>
  );
}

function AppointmentCard({ appointment, timezone, onOpen, style }: {
  appointment: CalendarAppointment;
  timezone: string;
  onOpen: (rect: DOMRect) => void;
  style: CSSProperties;
}) {
  const duration = durationMinutes(appointment.startAt, appointment.endAt);
  const density = duration < 45 ? "compact" : "standard";
  const color = barberColor(appointment.barberId);
  return (
    <button
      aria-label={`${appointment.customerName}, ${appointment.serviceName}, ${timeLabel(appointment.startAt, timezone)} to ${timeLabel(appointment.endAt, timezone)}, ${appointment.barberName}`}
      className={cn(
        "calendar-card z-10 overflow-hidden rounded-[6px] border-0 text-left transition-[filter] hover:brightness-[0.94] focus-visible:z-30",
        density === "compact"
          ? "flex items-center gap-1.5 px-2 text-[11px] leading-none"
          : "px-2 py-1 text-[11px] leading-[14px]",
      )}
      data-density={density}
      data-visual="solid"
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
      style={{
        ...style,
        backgroundColor: color.event,
        color: color.text,
      }}
      type="button"
    >
      {density === "compact" ? (
        <>
          <span className="shrink-0 font-medium opacity-80">{timeLabel(appointment.startAt, timezone)}</span>
          <strong className="min-w-0 truncate font-semibold">{appointment.customerName} · {appointment.serviceName}</strong>
        </>
      ) : (
        <>
          <strong className="block truncate font-semibold">{appointment.customerName} · {appointment.serviceName}</strong>
          <span className="block truncate opacity-80">{timeLabel(appointment.startAt, timezone)}–{timeLabel(appointment.endAt, timezone)}</span>
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
  const compact = durationMinutes(refill.slotStartAt, refill.slotEndAt) < 45;
  return (
    <button
      aria-label={`${refill.customerState} Open refill timeline`}
      className={cn(
        "calendar-card z-20 overflow-hidden rounded-[6px] border-0 bg-[#e37400] text-left text-[11px] text-white transition-[filter] hover:brightness-[0.94]",
        compact ? "flex items-center gap-1.5 px-2 leading-none" : "px-2 py-1 leading-[14px]",
      )}
      data-density={compact ? "compact" : "standard"}
      onClick={onOpen}
      style={style}
      type="button"
    >
      {compact ? (
        <>
          <span className="shrink-0 font-medium opacity-80">{timeLabel(refill.slotStartAt, timezone)}</span>
          <strong className="min-w-0 truncate font-semibold">Open chair · {refill.barberName}</strong>
        </>
      ) : (
        <>
          <strong className="block truncate font-semibold">Open chair · {refill.barberName}</strong>
          <span className="block truncate opacity-80">{timeLabel(refill.slotStartAt, timezone)}–{timeLabel(refill.slotEndAt, timezone)}</span>
        </>
      )}
    </button>
  );
}

function TimeRuler({ startHour, endHour }: { startHour: number; endHour: number }) {
  return (
    <div aria-hidden="true" className="relative border-r border-[#e8eaed] bg-white">
      {Array.from({ length: endHour - startHour }, (_, index) => (
        <span
          className={cn(
            "absolute right-3 text-[10px] font-medium text-[#70757a]",
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
    <section
      aria-label="Day calendar"
      className="flex h-full min-h-0 min-w-[680px] flex-col bg-white"
      data-end-hour={endHour}
      data-start-hour={startHour}
    >
      <div
        className="grid min-h-[66px] shrink-0 border-b border-[#e8eaed] bg-white"
        role="row"
        style={{ gridTemplateColumns: "64px minmax(0, 1fr)" }}
      >
        <div className="border-r border-[#e8eaed]" />
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, barbers.length)}, minmax(0, 1fr))` }}>
          {barbers.map((barber) => {
            const count = calendar.appointments.filter((appointment) => (
              appointment.status === "confirmed"
              && appointment.barberId === barber.id
              && localDate(appointment.startAt, calendar.timezone) === date
            )).length;
            return (
              <div
                aria-label={barber.name}
                className="flex items-center justify-center gap-2 border-r border-[#e8eaed] px-3 last:border-r-0"
                key={barber.id}
                role="columnheader"
              >
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
                  style={{ backgroundColor: barberColor(barber.id).dot }}
                >
                  {barber.name.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-[13px] font-semibold text-ink">{barber.name}</strong>
                  <span className="block text-[10px] text-muted">{count} {count === 1 ? "event" : "events"}</span>
                </span>
              </div>
            );
          })}
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
          style={{ gridTemplateColumns: "64px minmax(0, 1fr)" }}
        >
          <TimeRuler endHour={endHour} startHour={startHour} />
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, barbers.length)}, minmax(0, 1fr))` }}
          >
            {barbers.map((barber) => (
              <div className="relative border-r border-[#e8eaed] last:border-r-0" key={barber.id} style={{ height: laneHeight }}>
                <HourLines endHour={endHour} startHour={startHour} />
                {calendar.appointments
                  .filter((appointment) => appointment.status === "confirmed")
                  .filter((appointment) => appointment.barberId === barber.id)
                  .filter((appointment) => localDate(appointment.startAt, calendar.timezone) === date)
                  .map((appointment) => (
                    <AppointmentCard
                      appointment={appointment}
                      key={appointment.id}
                      onOpen={(rect) => onAppointment(appointment, rect)}
                      style={{
                        ...cardStyle(appointment.startAt, appointment.endAt, calendar.timezone, startHour * 60),
                        left: 5,
                        right: 5,
                      }}
                      timezone={calendar.timezone}
                    />
                  ))}
                {calendar.activeRefills
                  .filter((refill) => refill.barberId === barber.id)
                  .filter((refill) => localDate(refill.slotStartAt, calendar.timezone) === date)
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
    <section aria-label="Week calendar" className="flex h-full min-h-0 min-w-[980px] flex-col bg-white" data-end-hour={endHour} data-start-hour={startHour}>
      <div className="grid min-h-[58px] shrink-0 border-b border-[#e8eaed] bg-white" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
        <div className="border-r border-[#e8eaed]" />
        {dates.map((date) => (
          <div className="flex items-center justify-center border-r border-[#e8eaed] px-2 last:border-r-0" key={date}>
            <span className="text-center">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{DateTime.fromISO(date).toFormat("ccc")}</span>
              <span className="mt-0.5 block text-[18px] font-medium text-ink">{DateTime.fromISO(date).day}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="calendar-scroll-region"
        onScroll={(event) => saveCalendarScroll(event.currentTarget.scrollTop)}
        ref={scrollRef}
      >
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
          <TimeRuler endHour={endHour} startHour={startHour} />
          {dates.map((date) => (
            <div className="relative border-r border-[#e8eaed] last:border-r-0" key={date} style={{ height: laneHeight }}>
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
    <section aria-label="Month calendar" className="overflow-hidden border border-[#e8eaed] bg-white">
      <div className="grid grid-cols-7 border-b border-[#e8eaed] bg-white">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div className="border-r border-[#e8eaed] px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted last:border-r-0" key={day}>{day}</div>
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
          return (
            <button
              aria-label={`Open ${value.toFormat("cccc, LLLL d")}`}
              className={cn(
                "min-h-32 border-b border-r border-[#e8eaed] bg-white p-2 text-left transition-colors hover:bg-[#f8f9fa]",
                value.month !== anchorMonth && "bg-[#f8f9fa] text-[#9aa0a6]",
              )}
              key={date}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span className="flex items-center justify-between px-1 text-xs font-medium">
                <span className={cn(
                  "grid h-6 w-6 place-items-center rounded-full",
                  date === calendar.demoDate && "bg-landing-coral text-white",
                )}>{value.day}</span>
                {refills.length > 0 ? <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#a74836]">Open</span> : null}
              </span>
              <span className="mt-2 block space-y-1">
                {appointments.slice(0, 3).map((appointment) => {
                  const color = barberColor(appointment.barberId);
                  return (
                    <span
                      className="block truncate rounded-[4px] px-1.5 py-1 text-[11px] font-medium"
                      key={appointment.id}
                      style={{ backgroundColor: color.event, color: color.text }}
                    >
                      {timeLabel(appointment.startAt, calendar.timezone)} {appointment.customerName}
                    </span>
                  );
                })}
                {appointments.length > 3 ? <span className="block px-1 text-[10px] text-muted">+{appointments.length - 3} more</span> : null}
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
          <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ backgroundColor: barberColor(appointment.barberId).event }} />
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

function CalendarLoadingGrid() {
  return (
    <div aria-label="Loading calendar" className="flex h-full min-h-[560px] flex-col bg-white">
      <div className="grid h-[66px] shrink-0 grid-cols-[64px_1fr] border-b border-[#e8eaed]">
        <div className="border-r border-[#e8eaed]" />
        <div className="grid grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div className="flex items-center justify-center gap-2 border-r border-[#e8eaed] last:border-r-0" key={index}>
              <span className="h-8 w-8 animate-pulse rounded-full bg-[#eef0f2]" />
              <span className="h-3 w-14 animate-pulse rounded bg-[#eef0f2]" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-[64px_1fr]">
        <div className="border-r border-[#e8eaed] bg-white" />
        <div className="calendar-loading-lines grid grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div className="relative border-r border-[#e8eaed] last:border-r-0" key={index}>
              <span className="absolute left-2 right-2 top-20 h-12 animate-pulse rounded-[6px] bg-[#f3f4f5]" />
              <span className="absolute left-2 right-2 top-52 h-16 animate-pulse rounded-[6px] bg-[#f3f4f5]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarIntegrations({
  configuration,
  connection,
  googleBusy,
  googleReady,
  onGoogleAction,
  onGoogleDisconnect,
  onStatus,
}: {
  configuration: GoogleCalendarOAuthConfig | undefined;
  connection: GoogleCalendarConnectionState | undefined;
  googleBusy: boolean;
  googleReady: boolean;
  onGoogleAction: () => void;
  onGoogleDisconnect: () => void;
  onStatus: (message: string) => void;
}) {
  const googleStatus = googleBusy
    ? "Working…"
    : connection !== undefined
      ? `Connected · ${connection.calendarCount} ${connection.calendarCount === 1 ? "calendar" : "calendars"}`
      : configuration === undefined
        ? "Checking setup…"
        : !configuration.configured
          ? "Setup required"
          : googleReady
            ? "Not connected"
            : "Loading sign-in…";

  return (
    <section aria-label="Calendar integrations">
      <div className="space-y-2">
        <div className="flex items-center rounded-[10px] border border-[#e2e5e9] bg-white transition-colors hover:bg-[#f8f9fa]">
          <button
            aria-label={connection === undefined ? "Connect Google Calendar" : "Check Google Calendar access"}
            className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left disabled:cursor-wait"
            disabled={googleBusy}
            onClick={onGoogleAction}
            type="button"
          >
            <GoogleCalendarIcon className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-semibold text-ink">Google Calendar</strong>
              <span className={cn(
                "mt-0.5 block truncate text-xs",
                connection === undefined ? "text-muted" : "text-[#188038]",
              )}>
                {googleStatus}
              </span>
            </span>
            {googleBusy || connection !== undefined
              ? <SyncIcon className={cn("h-4 w-4 text-muted", googleBusy && "animate-spin")} />
              : <span className="text-xs font-semibold text-[#1a73e8]">Add</span>}
          </button>
          {connection === undefined ? null : (
            <button
              aria-label="Disconnect Google Calendar"
              className="mr-2 rounded px-2 py-1 text-xs font-medium text-muted hover:bg-white hover:text-ink"
              disabled={googleBusy}
              onClick={onGoogleDisconnect}
              type="button"
            >
              Remove
            </button>
          )}
        </div>
        <button
          aria-label="Connect Outlook Calendar"
          className="flex w-full items-center gap-3 rounded-[10px] border border-[#e2e5e9] bg-white px-3.5 py-3 text-left transition-colors hover:bg-[#f8f9fa]"
          onClick={() => onStatus("Outlook Calendar is not available in this build yet.")}
          type="button"
        >
          <OutlookIcon className="h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-semibold text-ink">Outlook</strong>
            <span className="mt-0.5 block truncate text-xs text-muted">Not connected</span>
          </span>
          <span className="text-xs font-semibold text-muted">Soon</span>
        </button>
      </div>
    </section>
  );
}

export function CalendarPage({
  api,
  googleCalendarIntegration = browserGoogleCalendarIntegration,
  calendar,
  anchorDate,
  view,
  barberFilter,
  loading,
  onAnchorDateChange,
  onViewChange,
  onBarberFilterChange,
  onMutated,
}: CalendarPageProps) {
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment>();
  const [anchorRect, setAnchorRect] = useState<DOMRect>();
  const [selectedRefill, setSelectedRefill] = useState<ActiveRefill>();
  const [editor, setEditor] = useState<"new" | "edit">();
  const [googleConfiguration, setGoogleConfiguration] = useState<GoogleCalendarOAuthConfig>();
  const [googleConnection, setGoogleConnection] = useState<GoogleCalendarConnectionState>();
  const [googleReady, setGoogleReady] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const range = useMemo(() => periodRange(anchorDate, view), [anchorDate, view]);

  useEffect(() => {
    let active = true;
    setGoogleReady(false);
    void api.getGoogleCalendarOAuthConfig()
      .then(async (configuration) => {
        if (!active) return;
        setGoogleConfiguration(configuration);
        if (!configuration.configured) return;
        await googleCalendarIntegration.prepare(configuration.clientId);
        if (active) setGoogleReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGoogleConfiguration({ configured: false });
        setSyncNotice(googleCalendarErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api, googleCalendarIntegration]);

  const connectOrVerifyGoogleCalendar = async () => {
    if (googleBusy) return;
    if (googleConfiguration === undefined) {
      setSyncNotice("Google Calendar setup is still loading.");
      return;
    }
    if (!googleConfiguration.configured) {
      setSyncNotice("Google Calendar needs an OAuth client ID before it can connect.");
      return;
    }
    if (!googleReady) {
      setSyncNotice("Google sign-in is still loading. Try again in a moment.");
      return;
    }

    setGoogleBusy(true);
    try {
      const currentConnection = googleConnection !== undefined && googleConnection.expiresAt > Date.now() + 5_000
        ? googleConnection
        : undefined;
      if (currentConnection === undefined) {
        if (googleConnection !== undefined) setGoogleConnection(undefined);
        const token = await googleCalendarIntegration.connect();
        const verification = await googleCalendarIntegration.verify(token.accessToken);
        setGoogleConnection({ ...token, ...verification });
        setSyncNotice(
          verification.primaryCalendarName === undefined
            ? `Google Calendar connected · ${verification.calendarCount} calendars available.`
            : `Google Calendar connected · ${verification.primaryCalendarName}.`,
        );
      } else {
        const verification = await googleCalendarIntegration.verify(currentConnection.accessToken);
        setGoogleConnection({ ...currentConnection, ...verification });
        setSyncNotice("Google Calendar access verified.");
      }
    } catch (error) {
      if (
        error instanceof GoogleCalendarIntegrationError
        && (error.code === "AUTH_EXPIRED" || error.code === "INVALID_ACCESS_TOKEN")
      ) {
        setGoogleConnection(undefined);
      }
      setSyncNotice(googleCalendarErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const disconnectGoogleCalendar = async () => {
    if (googleConnection === undefined || googleBusy) return;
    const accessToken = googleConnection.accessToken;
    setGoogleBusy(true);
    try {
      await googleCalendarIntegration.disconnect(accessToken);
      setSyncNotice("Google Calendar disconnected.");
    } catch (error) {
      setSyncNotice(`${googleCalendarErrorMessage(error)} The local connection was cleared.`);
    } finally {
      setGoogleConnection(undefined);
      setGoogleBusy(false);
    }
  };

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
    <section
      aria-busy={loading}
      className="relative mx-auto flex h-[calc(100vh-65px)] min-h-0 max-w-[1900px] flex-col overflow-hidden bg-white"
    >
      <h2 className="sr-only">Calendar</h2>
      {loading && calendar !== undefined ? <div className="calendar-progress absolute inset-x-0 top-0 z-40 h-[2px] bg-landing-coral" /> : null}
      <div className="shrink-0 border-b border-[#e8eaed] bg-white px-4 py-3 lg:px-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button className="mr-1 h-9 bg-white px-4" onClick={() => onAnchorDateChange(calendar?.demoDate ?? anchorDate)} variant="secondary">Today</Button>
            <IconButton aria-label="Previous period" className="rounded-full" onClick={() => onAnchorDateChange(movePeriod(anchorDate, view, -1))}>
              <ChevronLeftIcon className="h-4 w-4" />
            </IconButton>
            <IconButton aria-label="Next period" className="rounded-full" onClick={() => onAnchorDateChange(movePeriod(anchorDate, view, 1))}>
              <ChevronRightIcon className="h-4 w-4" />
            </IconButton>
            <h2 className="ml-2 min-w-44 text-[20px] font-medium tracking-[-0.025em] text-ink sm:text-[22px]">{periodLabel(anchorDate, view)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              aria-expanded={integrationsOpen}
              aria-haspopup="dialog"
              aria-label="Calendar integrations"
              className="h-9 px-2.5 sm:px-3"
              onClick={() => setIntegrationsOpen(true)}
              variant="secondary"
            >
              <GoogleCalendarIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Calendars</span>
            </Button>
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
            <Button aria-label="New appointment" className="h-9" onClick={openEditor} variant="primary">
              <PlusIcon className="h-4 w-4" />
              Create
            </Button>
          </div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)] bg-white max-[900px]:grid-cols-1">
        <aside className="min-h-0 overflow-y-auto border-r border-[#e8eaed] bg-white px-4 py-4 max-[900px]:hidden">
          <Button aria-label="Create appointment" className="mb-5 h-11 w-full justify-start rounded-[12px] bg-white px-4 shadow-[0_1px_3px_rgba(60,64,67,0.24)]" onClick={openEditor} variant="secondary">
            <PlusIcon className="h-5 w-5 text-landing-coral" />
            Create appointment
          </Button>
          <MiniMonth anchorDate={anchorDate} onSelect={selectMonthDate} />
          <div className="mt-6 border-t border-[#e8eaed] pt-5">
            <div className="mb-2 flex items-center">
              <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Team calendars</span>
            </div>
            <div className="space-y-1">
              {[{ id: "all", name: "All barbers" }, ...(calendar?.barbers ?? [])].map((barber) => (
                <button
                  aria-pressed={barberFilter === barber.id}
                  className={cn(
                    "flex h-9 w-full items-center rounded-[7px] px-2.5 text-left text-[13px] transition-colors",
                    barberFilter === barber.id
                      ? "bg-[#f1f3f4] font-semibold text-ink"
                      : "text-muted hover:bg-[#f8f9fa] hover:text-ink",
                  )}
                  key={barber.id}
                  onClick={() => onBarberFilterChange(barber.id)}
                  type="button"
                >
                  <span
                    className={cn("mr-2.5 h-2.5 w-2.5 rounded-[3px] border", barber.id === "all" && "border-[#5f6368]")}
                    style={barber.id === "all" ? undefined : {
                      backgroundColor: barberColor(barber.id).dot,
                      borderColor: barberColor(barber.id).dot,
                    }}
                  />
                  {barber.name}
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className={cn("min-h-0 min-w-0 overflow-x-auto", view === "month" ? "overflow-y-auto bg-white p-3" : "") }>
          {calendar === undefined ? (
            <CalendarLoadingGrid />
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
      {integrationsOpen ? (
        <Modal onClose={() => setIntegrationsOpen(false)} title="Calendar integrations">
          <CalendarIntegrations
            configuration={googleConfiguration}
            connection={googleConnection}
            googleBusy={googleBusy}
            googleReady={googleReady}
            onGoogleAction={connectOrVerifyGoogleCalendar}
            onGoogleDisconnect={disconnectGoogleCalendar}
            onStatus={setSyncNotice}
          />
          {syncNotice === "" ? null : (
            <p aria-live="polite" className="mt-4 rounded-[8px] bg-[#f6f7f8] px-3 py-2 text-xs leading-5 text-muted">{syncNotice}</p>
          )}
        </Modal>
      ) : null}
    </section>
  );
}
