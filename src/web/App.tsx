import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";

import { defaultApi } from "./api.js";
import {
  AgentIcon,
  CalendarIcon,
  CustomersIcon,
  SettingsIcon,
} from "./components/icons.js";
import { cn } from "./components/ui.js";
import { periodRange, type CalendarView } from "./lib/dates.js";
import { AgentPage } from "./pages/AgentPage.js";
import { CalendarPage } from "./pages/CalendarPage.js";
import { CustomersPage } from "./pages/CustomersPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import type { CalendarResponse, EventSourceLike, StandbyApi } from "./types.js";

export type AppPage = "calendar" | "agent" | "customers" | "settings";

interface DashboardAppProps {
  api?: StandbyApi;
  initialDate?: string;
  eventSourceFactory?: (url: string) => EventSourceLike | undefined;
}

const defaultEventSourceFactory = (url: string): EventSourceLike => new EventSource(url);

const destinations = [
  { id: "calendar" as const, label: "Calendar", icon: CalendarIcon },
  { id: "agent" as const, label: "Agent", icon: AgentIcon },
  { id: "customers" as const, label: "Customers", icon: CustomersIcon },
  { id: "settings" as const, label: "Settings", icon: SettingsIcon },
];

function nextOperationalDate(): string {
  let date = DateTime.now().setZone("America/Toronto").startOf("day");
  while (date.weekday > 5) date = date.plus({ days: 1 });
  return date.toISODate()!;
}

export function DashboardApp({
  api = defaultApi,
  initialDate = nextOperationalDate(),
  eventSourceFactory = defaultEventSourceFactory,
}: DashboardAppProps) {
  const [page, setPage] = useState<AppPage>("calendar");
  const [visitedPages, setVisitedPages] = useState<ReadonlySet<AppPage>>(
    () => new Set<AppPage>(["calendar"]),
  );
  const [anchorDate, setAnchorDate] = useState(initialDate);
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [barberFilter, setBarberFilter] = useState("all");
  const [calendar, setCalendar] = useState<CalendarResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [domainVersion, setDomainVersion] = useState(0);
  const requestSequence = useRef(0);
  const range = useMemo(() => periodRange(anchorDate, calendarView), [anchorDate, calendarView]);

  const navigateTo = (destination: AppPage) => {
    setVisitedPages((current) => current.has(destination)
      ? current
      : new Set([...current, destination]));
    setPage(destination);
  };

  const refreshCalendar = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const nextCalendar = await api.getCalendarRange(range.start, range.end);
      if (requestId === requestSequence.current) {
        setCalendar(nextCalendar);
        setError(undefined);
      }
    } catch {
      if (requestId === requestSequence.current) {
        setError("The calendar could not refresh. The last confirmed state remains visible.");
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [api, range.end, range.start]);
  const refreshCalendarRef = useRef(refreshCalendar);
  refreshCalendarRef.current = refreshCalendar;

  useEffect(() => { void refreshCalendar(); }, [refreshCalendar]);
  useEffect(() => {
    if (error === undefined) return;
    const retry = window.setTimeout(() => void refreshCalendar(), 2_000);
    return () => window.clearTimeout(retry);
  }, [error, refreshCalendar]);
  useEffect(() => {
    const source = eventSourceFactory("/api/v1/events");
    if (source === undefined) return;
    source.addEventListener("domain", () => {
      setDomainVersion((version) => version + 1);
      void refreshCalendarRef.current();
    });
    return () => source.close();
  }, [eventSourceFactory]);

  return (
    <div className="product-page min-h-screen font-landing-sans text-ink">
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="mx-auto grid min-h-[68px] max-w-[1760px] grid-cols-[1fr_auto_1fr] items-center rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-panel px-3 shadow-[0_12px_32px_rgba(16,23,34,0.08)] sm:px-4 max-[720px]:grid-cols-[auto_1fr]">
          <a className="justify-self-start" href="/">
            <h1
              aria-label="Standby"
              className="flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.035em]"
            >
              <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-[9px]">
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-cover"
                  decoding="async"
                  fetchPriority="high"
                  height="192"
                  src="/landing/standby-mark.webp"
                  width="192"
                />
              </span>
              <span className="max-[520px]:hidden">Standby</span>
            </h1>
          </a>
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 rounded-[11px] border border-[rgba(16,23,34,0.08)] bg-[#f3f1eb] p-1 max-[720px]:justify-self-end"
          >
            {destinations.map((destination) => {
              const Icon = destination.icon;
              return (
                <button
                  aria-current={page === destination.id ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-[8px] px-3.5 text-[13px] font-semibold transition-[color,background-color,box-shadow] max-[820px]:px-2.5",
                    page === destination.id
                      ? "bg-landing-ink text-white shadow-[0_5px_12px_rgba(16,23,34,0.16)]"
                      : "text-muted hover:bg-white hover:text-ink",
                  )}
                  key={destination.id}
                  onClick={() => navigateTo(destination.id)}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  <span className="max-[640px]:sr-only">{destination.label}</span>
                </button>
              );
            })}
          </nav>
          <a
            className="justify-self-end rounded-[8px] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted transition-colors hover:bg-white hover:text-ink max-[720px]:hidden"
            href="/"
          >
            View site
          </a>
        </div>
      </header>
      {error === undefined ? null : (
        <div className="mx-auto mt-3 max-w-[900px] rounded-[10px] border border-[#ead9b9] bg-amber-soft px-6 py-2.5 text-center text-sm text-[#7c5b22]">{error}</div>
      )}
      <main className="px-3 pb-3 pt-4 sm:px-5 sm:pb-5">
        <div hidden={page !== "calendar"}>
          <CalendarPage
            anchorDate={anchorDate}
            api={api}
            barberFilter={barberFilter}
            calendar={calendar}
            loading={loading}
            onAnchorDateChange={setAnchorDate}
            onBarberFilterChange={setBarberFilter}
            onMutated={refreshCalendar}
            onViewChange={setCalendarView}
            view={calendarView}
          />
        </div>
        {visitedPages.has("agent") ? (
          <div hidden={page !== "agent"}>
            <AgentPage api={api} refreshKey={domainVersion} />
          </div>
        ) : null}
        {visitedPages.has("customers") ? (
          <div hidden={page !== "customers"}>
            <CustomersPage api={api} refreshKey={domainVersion} />
          </div>
        ) : null}
        {visitedPages.has("settings") ? (
          <div hidden={page !== "settings"}>
            <SettingsPage
              api={api}
              onReset={async () => {
                setDomainVersion((version) => version + 1);
                await refreshCalendar();
              }}
              refreshKey={domainVersion}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
