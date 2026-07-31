import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

import { PhoneIcon, TelegramIcon } from "../components/icons.js";
import { EmptyState, SegmentedControl, cn } from "../components/ui.js";
import type {
  ActivityItem,
  ConversationDetail,
  ConversationEvent,
  ConversationSummary,
  OperatorWaitlistEntry,
  OperatorSnapshot,
  StandbyApi,
} from "../types.js";

type AgentTab = "inbox" | "waitlist" | "activity";
type ChannelFilter = "all" | "telegram" | "voice";

interface AgentPageProps {
  api: StandbyApi;
  refreshKey: number;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function timestamp(value: string, format = "h:mm a"): string {
  return DateTime.fromISO(value).setZone("America/Toronto").toFormat(format);
}

function ConversationRow({ conversation, selected, onSelect }: {
  conversation: ConversationSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const isTelegram = conversation.channel === "telegram";
  const ChannelIcon = isTelegram ? TelegramIcon : PhoneIcon;
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "w-full border-b border-line px-4 py-3.5 text-left transition-colors",
        selected ? "bg-[#eef1f5]" : "bg-panel hover:bg-white",
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border",
            isTelegram
              ? "border-[#c9d2dc] bg-[#eaf0f6] text-[#34465d]"
              : "border-[#e8b8ac] bg-landing-coral-soft text-[#a74836]",
          )}>
            <ChannelIcon className="h-3.5 w-3.5" />
          </span>
          <strong className="truncate text-sm font-semibold">{conversation.customerName}</strong>
        </span>
        <time className="shrink-0 font-mono text-[9px] text-muted">{timestamp(conversation.updatedAt)}</time>
      </span>
      <span className="mt-1.5 flex items-center gap-1.5 pl-9 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {conversation.hasException ? <span className="text-[#8a611c]">Exception ·</span> : null}
        {isTelegram ? "Telegram" : "Phone call"} · {titleCase(conversation.direction)}
      </span>
      <span className="mt-1.5 block truncate pl-9 text-xs text-muted">{conversation.preview}</span>
    </button>
  );
}

function MessageEvent({ event }: { event: ConversationEvent }) {
  const isCustomer = event.speaker === "customer";
  const timeInCall = typeof event.metadata?.timeInCallSeconds === "number"
    ? `${Math.floor(event.metadata.timeInCallSeconds / 60)}:${String(event.metadata.timeInCallSeconds % 60).padStart(2, "0")}`
    : undefined;
  return (
    <div className={cn("flex", isCustomer ? "justify-end" : "justify-start")}>
      <article className={cn(
        "max-w-[78%] rounded-xl px-3.5 py-2.5 text-sm leading-6",
        isCustomer ? "rounded-br-[4px] bg-ink text-white" : "rounded-bl-[4px] border border-line bg-panel text-ink",
      )}>
        <span className={cn(
          "mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em]",
          isCustomer ? "text-white/60" : "text-muted",
        )}>
          {isCustomer ? "Customer" : "Standby"}{event.kind === "transcript" ? " · call transcript" : ""}
        </span>
        <p>{event.text}</p>
        <span className={cn("mt-1 flex items-center justify-between gap-4 font-mono text-[9px]", isCustomer ? "text-white/60" : "text-muted")}>
          <time>{timestamp(event.occurredAt)}</time>
          {timeInCall === undefined ? null : <span>call {timeInCall}</span>}
        </span>
      </article>
    </div>
  );
}

function LedgerEvent({ event }: { event: ConversationEvent }) {
  const warning = event.kind === "error" || event.deliveryState === "failed";
  return (
    <div className={cn(
      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-standby border bg-[#f6f4ee] px-3 py-2.5 text-xs",
      warning ? "border-[#e5d3ae]" : "border-line",
    )}>
      <span className={cn("justify-self-center text-center leading-5", warning ? "text-[#8a611c]" : "text-muted")}>{event.text}</span>
      <time className="justify-self-end font-mono text-[9px] text-muted">{timestamp(event.occurredAt)}</time>
    </div>
  );
}

function Transcript({ detail, loading }: { detail: ConversationDetail | undefined; loading: boolean }) {
  if (loading) return <div className="m-5 min-h-72 animate-pulse rounded-xl bg-[#f0eee8]" />;
  if (detail === undefined) {
    return (
      <EmptyState
        detail="Select a real Telegram message or voice call to inspect what Standby did."
        title="No conversation selected"
      />
    );
  }
  const events = [...detail.events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return (
    <div className="space-y-3 p-5">
      {events.map((event) => (
        event.kind === "message" || event.kind === "transcript"
          ? <MessageEvent event={event} key={event.id} />
          : <LedgerEvent event={event} key={event.id} />
      ))}
    </div>
  );
}

function ContextPanel({ detail }: { detail: ConversationDetail | undefined }) {
  const recentActivity = detail?.activity
    .filter((item) => item.type.startsWith("appointment.") || item.type.startsWith("offer."))
    .slice(0, 4) ?? [];
  return (
    <aside aria-label="Context" className="border-l border-t border-line bg-[#f7f5ef] lg:col-start-2 xl:col-start-auto xl:min-h-[calc(100vh-220px)] xl:border-t-0">
      <div className="flex h-12 items-center border-b border-line px-4">
        <h3 className="text-sm font-semibold">Context</h3>
      </div>
      {detail === undefined ? (
        <p className="p-4 text-sm leading-6 text-muted">Customer and scheduling context appears with a selected conversation.</p>
      ) : (
        <div className="divide-y divide-line">
          <section className="p-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Customer</h4>
            <strong className="mt-2 block text-sm">{detail.context.customer.name}</strong>
            <p className="mt-1 text-xs text-muted">{detail.context.customer.identitySummary}</p>
          </section>
          <section className="p-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Appointment</h4>
            {detail.context.appointment === undefined ? (
              <p className="mt-2 text-xs text-muted">No appointment attached</p>
            ) : (
              <>
                <strong className="mt-2 block text-sm">{detail.context.appointment.serviceName}</strong>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {detail.context.appointment.barberName} · {timestamp(detail.context.appointment.startAt, "ccc, LLL d · h:mm a")}
                </p>
              </>
            )}
          </section>
          <section className="p-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Automation</h4>
            <p className="mt-2 text-sm font-medium">{detail.context.automation.state}</p>
            {detail.context.automation.offerStatus === undefined ? null : (
              <p className="mt-1.5 text-xs capitalize text-muted">Offer {detail.context.automation.offerStatus.replaceAll("_", " ")}</p>
            )}
          </section>
          <section className="p-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Appointment activity</h4>
            {recentActivity.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No appointment changes yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {recentActivity.map((item) => (
                  <li className="grid grid-cols-[7px_1fr] gap-2" key={item.id}>
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-landing-coral" />
                    <span>
                      <span className="block text-xs leading-5 text-ink">{item.message}</span>
                      <time className="mt-0.5 block font-mono text-[9px] text-muted">
                        {timestamp(item.occurredAt, "LLL d · h:mm a")}
                      </time>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="p-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Private note</h4>
            <p className="mt-2 text-sm leading-6 text-muted">{detail.context.privateNote?.text ?? "No private note."}</p>
          </section>
        </div>
      )}
    </aside>
  );
}

function Inbox({ conversations, selectedId, detail, loadingDetail, search, channelFilter, onSearch, onChannelFilter, onSelect }: {
  conversations: ConversationSummary[];
  selectedId: string | undefined;
  detail: ConversationDetail | undefined;
  loadingDetail: boolean;
  search: string;
  channelFilter: ChannelFilter;
  onSearch: (value: string) => void;
  onChannelFilter: (value: ChannelFilter) => void;
  onSelect: (id: string) => void;
}) {
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => (
      (channelFilter === "all" || conversation.channel === channelFilter)
      && (
        conversation.customerName.toLocaleLowerCase().includes(query)
        || conversation.preview.toLocaleLowerCase().includes(query)
      )
    ));
  }, [channelFilter, conversations, search]);

  const counts = {
    all: conversations.length,
    telegram: conversations.filter((conversation) => conversation.channel === "telegram").length,
    voice: conversations.filter((conversation) => conversation.channel === "voice").length,
  };

  return (
    <div aria-label="Agent inbox" className="mx-auto grid w-full max-w-[1500px] overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]" role="region">
      <section className="border-r border-line">
        <div className="border-b border-line p-4">
          <h3 className="text-sm font-semibold">Conversations</h3>
          <label className="sr-only" htmlFor="conversation-search">Search conversations</label>
          <input
            className="mt-3 h-9 w-full rounded-standby border border-line bg-white px-3 text-xs placeholder:text-[#9fa69f]"
            id="conversation-search"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search customers"
            value={search}
          />
          <div aria-label="Conversation channels" className="mt-3 grid grid-cols-3 gap-1 rounded-standby bg-[#f0eee8] p-1" role="group">
            {([
              ["all", "All"],
              ["telegram", "Telegram"],
              ["voice", "Calls"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={channelFilter === value}
                className={cn(
                  "rounded-[6px] px-1 py-1.5 text-[10px] font-medium transition-colors",
                  channelFilter === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
                key={value}
                onClick={() => onChannelFilter(value)}
                type="button"
              >
                {label} <span className="font-mono text-[9px] opacity-60">{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>
        {conversations.length === 0 ? (
          <EmptyState
            detail="Real Telegram messages and voice calls will appear here as they happen."
            title="No provider activity yet"
          />
        ) : visible.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted">No conversations match that search.</p>
        ) : (
          <div>{visible.map((conversation) => (
            <ConversationRow
              conversation={conversation}
              key={conversation.id}
              onSelect={() => onSelect(conversation.id)}
              selected={conversation.id === selectedId}
            />
          ))}</div>
        )}
      </section>
      <section className="min-w-0">
        <div className="flex h-12 items-center justify-between border-b border-line px-5">
          <h3 className="text-sm font-semibold">Conversation</h3>
          {detail === undefined ? null : (
            <span className={cn(
              "rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]",
              detail.conversation.channel === "telegram"
                ? "bg-[#eaf0f6] text-[#34465d]"
                : "bg-landing-coral-soft text-[#a74836]",
            )}>
              {detail.conversation.channel === "telegram" ? "Telegram" : "Phone call"} · {titleCase(detail.conversation.state)}
            </span>
          )}
        </div>
        <Transcript detail={detail} loading={loadingDetail} />
      </section>
      <ContextPanel detail={detail} />
    </div>
  );
}

function WaitlistPanel({ api, entries, onEntriesChange }: {
  api: StandbyApi;
  entries: OperatorWaitlistEntry[];
  onEntriesChange: (entries: OperatorWaitlistEntry[]) => void;
}) {
  const [editingNote, setEditingNote] = useState<string>();
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [status, setStatus] = useState<string>();
  const visible = entries.filter((entry) => entry.status !== "withdrawn" && entry.status !== "fulfilled");

  const update = async (entry: OperatorWaitlistEntry, patch: { status?: "active" | "paused" | "withdrawn"; operatorNote?: string | null }) => {
    setStatus("Saving…");
    try {
      const updated = await api.patchWaitlist(entry.id, patch);
      onEntriesChange(entries.map((candidate) => candidate.id === entry.id ? updated : candidate));
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That waitlist change could not be saved.");
    }
  };

  return (
    <section aria-label="Open waitlist" className="mx-auto max-w-5xl overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold">Open waitlist</h3>
          <p className="mt-1 text-xs text-muted">Pause outreach, leave context, or withdraw an entry.</p>
        </div>
        {status === undefined ? null : <span className="font-mono text-[10px] text-muted">{status}</span>}
      </div>
      {visible.length === 0 ? (
        <EmptyState detail="New customer requests will appear here when they join the waitlist." title="Waitlist is clear" />
      ) : (
        <div className="divide-y divide-line">
          {visible.map((entry) => (
            <article className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]" key={entry.id}>
              <div>
                <span className="flex items-center gap-2">
                  <strong className="text-sm font-semibold">{entry.customerName}</strong>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]",
                    entry.status === "paused"
                      ? "bg-[#f2f0ea] text-muted"
                      : "bg-[#eaf0f6] text-[#34465d]",
                  )}>{entry.status}</span>
                </span>
                <p className="mt-1 text-sm text-muted">{entry.serviceName} · {entry.barberName}</p>
                <p className="mt-1 font-mono text-[10px] text-muted">
                  {timestamp(entry.earliestStart, "ccc, LLL d · h:mm a")}–{timestamp(entry.latestStart)} · {titleCase(entry.channel)}
                </p>
                {entry.operatorNote === undefined ? null : <p className="mt-2 text-xs italic text-muted">{entry.operatorNote}</p>}
                {editingNote === entry.id ? (
                  <div className="mt-3 flex max-w-lg gap-2">
                    <label className="sr-only" htmlFor={`waitlist-note-${entry.id}`}>Private note for {entry.customerName}</label>
                    <input
                      className="h-9 flex-1 rounded-standby border border-line px-3 text-sm"
                      id={`waitlist-note-${entry.id}`}
                      onChange={(event) => setNote(event.target.value)}
                      value={note}
                    />
                    <button
                      aria-label={`Save note for ${entry.customerName}`}
                      className="rounded-standby bg-ink px-3 text-xs font-medium text-white disabled:opacity-40"
                      disabled={note.trim() === ""}
                      onClick={() => {
                        const text = note.trim();
                        setEditingNote(undefined);
                        setNote("");
                        void update(entry, { operatorNote: text });
                      }}
                      type="button"
                    >Save</button>
                  </div>
                ) : null}
              </div>
              <div className="flex items-start gap-1.5">
                <button
                  aria-label={`${entry.status === "paused" ? "Resume" : "Pause"} ${entry.customerName}`}
                  className="h-8 rounded-standby border border-line px-3 text-xs font-medium text-muted hover:text-ink"
                  onClick={() => void update(entry, { status: entry.status === "paused" ? "active" : "paused" })}
                  type="button"
                >{entry.status === "paused" ? "Resume" : "Pause"}</button>
                <button
                  aria-label={`${entry.operatorNote === undefined ? "Add" : "Edit"} note for ${entry.customerName}`}
                  className="h-8 rounded-standby border border-line px-3 text-xs font-medium text-muted hover:text-ink"
                  onClick={() => {
                    setEditingNote(entry.id);
                    setNote(entry.operatorNote ?? "");
                  }}
                  type="button"
                >Note</button>
                {removing === entry.id ? (
                  <button
                    aria-label={`Confirm remove ${entry.customerName}`}
                    className="h-8 rounded-standby border border-[#e6caca] px-3 text-xs font-medium text-[#9e3f3f]"
                    onClick={() => void update(entry, { status: "withdrawn" })}
                    type="button"
                  >Confirm</button>
                ) : (
                  <button
                    aria-label={`Remove ${entry.customerName}`}
                    className="h-8 rounded-standby px-2 text-xs text-muted hover:text-[#9e3f3f]"
                    onClick={() => setRemoving(entry.id)}
                    type="button"
                  >Remove</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityPanel({ activity }: { activity: ActivityItem[] }) {
  return (
    <section aria-label="Scheduling activity" className="mx-auto max-w-4xl overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel">
      <div className="border-b border-line px-5 py-4">
        <h3 className="text-sm font-semibold">Scheduling activity</h3>
        <p className="mt-1 text-xs text-muted">Plain-language changes committed by Standby and the front desk.</p>
      </div>
      {activity.length === 0 ? (
        <EmptyState detail="Committed scheduling changes will appear here." title="No activity yet" />
      ) : (
        <ol className="divide-y divide-line">
          {activity.map((item) => (
            <li className="grid grid-cols-[1fr_auto] items-start gap-3 px-5 py-4" key={item.id}>
              <p className="text-sm leading-6">{item.message}</p>
              <time className="font-mono text-[10px] text-muted">{timestamp(item.occurredAt, "LLL d · h:mm a")}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AgentLoadingShell() {
  return (
    <div aria-label="Loading agent workspace" className="mx-auto grid min-h-[620px] w-full max-w-[1500px] overflow-hidden rounded-[14px] border border-line bg-white lg:grid-cols-[280px_minmax(0,1fr)_300px]" role="status">
      <div className="border-r border-line p-4">
        <div className="h-10 animate-pulse rounded-[8px] bg-[#f1f3f4]" />
        <div className="mt-5 space-y-4">
          {[0, 1, 2, 3].map((item) => (
            <div className="flex gap-3" key={item}>
              <span className="h-8 w-8 shrink-0 animate-pulse rounded-[8px] bg-[#f1f3f4]" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-24 animate-pulse rounded bg-[#f1f3f4]" />
                <span className="block h-2.5 w-full animate-pulse rounded bg-[#f5f6f7]" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-r border-line p-6">
        <div className="mx-auto mt-16 max-w-lg space-y-5">
          <div className="h-16 w-3/4 animate-pulse rounded-xl bg-[#f1f3f4]" />
          <div className="ml-auto h-20 w-2/3 animate-pulse rounded-xl bg-[#f1f3f4]" />
          <div className="h-12 w-4/5 animate-pulse rounded-xl bg-[#f5f6f7]" />
        </div>
      </div>
      <div className="hidden p-5 lg:block">
        <div className="h-3 w-20 animate-pulse rounded bg-[#f1f3f4]" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((item) => <div className="h-14 animate-pulse rounded-[8px] bg-[#f5f6f7]" key={item} />)}
        </div>
      </div>
      <span className="sr-only">Loading agent activity</span>
    </div>
  );
}

export function AgentPage({ api, refreshKey }: AgentPageProps) {
  const [tab, setTab] = useState<AgentTab>("inbox");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [waitlist, setWaitlist] = useState<OperatorWaitlistEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [error, setError] = useState<string>();

  const selectConversation = (id: string | undefined) => {
    if (id === selectedId) return;
    setSelectedId(id);
  };

  const changeChannelFilter = (value: ChannelFilter) => {
    setChannelFilter(value);
    if (value === "all") return;
    const selectedMatches = conversations.some((conversation) => (
      conversation.id === selectedId && conversation.channel === value
    ));
    if (!selectedMatches) {
      selectConversation(conversations.find((conversation) => conversation.channel === value)?.id);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    const loadSnapshot = async (): Promise<OperatorSnapshot> => {
      if (api.getOperatorSnapshot !== undefined) return api.getOperatorSnapshot();
      const [nextConversations, nextWaitlist, nextActivity] = await Promise.all([
        api.getConversations(),
        api.getWaitlist(),
        api.getActivity(),
      ]);
      const selectedConversation = nextConversations[0] === undefined
        ? undefined
        : await api.getConversation(nextConversations[0].id);
      return {
        conversations: nextConversations,
        ...(selectedConversation === undefined ? {} : { selectedConversation }),
        waitlist: nextWaitlist,
        activity: nextActivity,
        generatedAt: new Date().toISOString(),
      };
    };
    void loadSnapshot().then((snapshot) => {
      if (!active) return;
      setConversations(snapshot.conversations);
      setWaitlist(snapshot.waitlist);
      setActivity(snapshot.activity);
      setError(undefined);
      setSelectedId((current) => (
        current !== undefined && snapshot.conversations.some((conversation) => conversation.id === current)
          ? current
          : snapshot.selectedConversation?.conversation.id ?? snapshot.conversations[0]?.id
      ));
      setDetail((current) => {
        if (
          current !== undefined
          && snapshot.conversations.some((conversation) => conversation.id === current.conversation.id)
        ) return current;
        return snapshot.selectedConversation;
      });
    }).catch(() => {
      if (active) setError("Conversation activity could not be refreshed.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, refreshKey]);

  useEffect(() => {
    if (selectedId === undefined || detail?.conversation.id === selectedId) return;
    let active = true;
    setLoadingDetail(true);
    void api.getConversation(selectedId).then((nextDetail) => {
      if (active) setDetail(nextDetail);
    }).catch(() => {
      if (active) setError("That conversation could not be loaded.");
    }).finally(() => {
      if (active) setLoadingDetail(false);
    });
    return () => { active = false; };
  }, [api, selectedId, refreshKey, detail?.conversation.id]);

  return (
    <section className="mx-auto max-w-[1760px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 px-1 py-2">
        <div>
          <h2 className="text-[32px] font-semibold tracking-[-0.05em]">Agent</h2>
          <p className="mt-1 text-sm text-muted">Voice and message activity, with every decision in context.</p>
        </div>
        <SegmentedControl
          label="Agent workspace"
          onChange={setTab}
          options={[
            { value: "inbox", label: "Inbox" },
            { value: "waitlist", label: "Waitlist" },
            { value: "activity", label: "Activity" },
          ]}
          value={tab}
        />
      </div>
      <div>
        {error === undefined ? null : (
          <p className="mx-auto mb-4 max-w-[1500px] rounded-standby border border-[#ead9b9] bg-amber-soft px-4 py-3 text-sm text-[#7c5b22]" role="alert">
            {error}
          </p>
        )}
        {loading && conversations.length === 0 && tab === "inbox" ? (
          <AgentLoadingShell />
        ) : tab === "inbox" ? (
          <Inbox
            channelFilter={channelFilter}
            conversations={conversations}
            detail={detail}
            loadingDetail={loadingDetail}
            onChannelFilter={changeChannelFilter}
            onSearch={setSearch}
            onSelect={selectConversation}
            search={search}
            selectedId={selectedId}
          />
        ) : tab === "waitlist" ? (
          <WaitlistPanel api={api} entries={waitlist} onEntriesChange={setWaitlist} />
        ) : (
          <ActivityPanel activity={activity} />
        )}
      </div>
    </section>
  );
}
