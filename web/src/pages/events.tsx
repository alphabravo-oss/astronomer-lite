import { ArrowDownUp, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { BottomPanel } from "../components/ui/bottom-panel";
import { Button } from "../components/ui/button";
import { useWatch } from "../hooks/use-watch";
import type { ClusterEvent, WatchFrame } from "../lib/api";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

type EventsPageProps = {
  selectedNamespaces: string[];
};

type SortKey = "lastTimestamp" | "namespace" | "type" | "reason" | "regardingKind" | "count";
type SortDirection = "asc" | "desc";

export function EventsPage({ selectedNamespaces }: EventsPageProps) {
  const { clusterId = "" } = useParams();
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ClusterEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("lastTimestamp");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const loadEvents = useCallback(async () => {
    if (!clusterId) return;
    setLoading(true);
    try {
      setEvents(await api.events(clusterId, selectedNamespaces));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [clusterId, selectedNamespaces]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const watchStatus = useWatch({
    clusterId,
    gvr: { group: "events.k8s.io", version: "v1", resource: "events", kind: "Event", namespaced: true },
    namespaces: selectedNamespaces,
    errorMessage: "Event watch failed",
    onReset: () => void loadEvents(),
    onError: (message) => setError(message),
    onFrame: (frame: WatchFrame) => {
      if (!frame.object || frame.type === "BOOKMARK") return;
      const event = eventFromObject(frame.object);
      if (!event) return;
      const key = eventKey(event);
      setEvents((current) => {
        if (frame.type === "DELETED") {
          return current.filter((item) => eventKey(item) !== key);
        }
        const next = current.filter((item) => eventKey(item) !== key);
        next.push(event);
        return next;
      });
    }
  });

  const eventTypes = useMemo(() => uniqueValues(events.map((event) => event.type).filter(Boolean)), [events]);
  const regardingKinds = useMemo(() => uniqueValues(events.map((event) => event.regardingKind).filter(Boolean)), [events]);

  const visibleEvents = useMemo(() => {
    const search = query.trim().toLowerCase();
    return events
      .filter((event) => typeFilter === "all" || event.type === typeFilter)
      .filter((event) => kindFilter === "all" || event.regardingKind === kindFilter)
      .filter((event) => {
        if (!search) return true;
        return [
          event.name,
          event.namespace,
          event.type,
          event.reason,
          event.note,
          event.action,
          event.regardingKind,
          event.regardingName,
          event.reportingController
        ].some((value) => (value ?? "").toLowerCase().includes(search));
      })
      .sort((a, b) => compareEvents(a, b, sortKey, sortDirection));
  }, [events, kindFilter, query, sortDirection, sortKey, typeFilter]);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "lastTimestamp" ? "desc" : "asc");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedNamespaces.length === 0
              ? "Newest Kubernetes events across all namespaces."
              : `Newest Kubernetes events filtered to ${selectedNamespaces.join(", ")}.`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadEvents()} disabled={loading}>
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="event-search"
            name="event-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <select
          id="event-type-filter"
          name="event-type-filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label="Filter by event type"
        >
          <option value="all">All types</option>
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          id="event-kind-filter"
          name="event-kind-filter"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label="Filter by involved kind"
        >
          <option value="all">All kinds</option>
          {regardingKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs uppercase text-muted-foreground">Watch: {watchStatus}</div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <SortableHeader label="Last seen" sortKey="lastTimestamp" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Namespace" sortKey="namespace" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Type" sortKey="type" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Reason" sortKey="reason" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Object" sortKey="regardingKind" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <th className="px-4 py-3 font-medium">Message</th>
              <SortableHeader label="Count" sortKey="count" active={sortKey} direction={sortDirection} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((event) => (
              <tr key={eventKey(event)} className="table-row-hover border-t border-border" onClick={() => setSelectedEvent(event)}>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{event.age || formatEventTime(event.lastTimestamp)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{event.namespace || "-"}</td>
                <td className="px-4 py-3">
                  <Badge tone={event.type === "Warning" ? "warning" : "success"}>{event.type || "Normal"}</Badge>
                </td>
                <td className="px-4 py-3 font-medium">{event.reason || "-"}</td>
                <td className="max-w-64 px-4 py-3">
                  <div className="truncate font-mono text-xs">{event.regardingName || "-"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{event.regardingKind || "Object"}</div>
                </td>
                <td className="max-w-[28rem] truncate px-4 py-3 text-muted-foreground">{event.note || event.action || "-"}</td>
                <td className="px-4 py-3 tabular-nums">{event.count}</td>
              </tr>
            ))}
            {visibleEvents.length === 0 ? (
              <tr>
                <td className="bg-card px-4 py-8 text-center text-muted-foreground" colSpan={7}>
                  {loading ? "Loading events..." : "No events found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {selectedEvent ? <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  direction,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="px-4 py-3 font-medium">
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        <ArrowDownUp className={cn("h-3 w-3", active === sortKey && direction === "desc" && "rotate-180")} />
      </button>
    </th>
  );
}

function EventDrawer({ event, onClose }: { event: ClusterEvent; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState("message");

  return (
    <BottomPanel
      open
      onClose={onClose}
      title={event.reason || event.name}
      subtitle={`${event.namespace || "cluster"} / ${event.type || "Normal"}`}
      tabs={[
        { key: "message", label: "Message" },
        { key: "details", label: "Details" }
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      <div className="h-full overflow-y-auto p-4">
        {activeTab === "message" ? (
          <section className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={event.type === "Warning" ? "warning" : "success"}>{event.type || "Normal"}</Badge>
              <span className="text-xs text-muted-foreground">{event.namespace || "cluster"}</span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{event.note || event.action || "No message recorded."}</p>
          </section>
        ) : (
          <section className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm sm:grid-cols-2">
            <Detail label="Object" value={`${event.regardingKind || "Object"}/${event.regardingName || "-"}`} />
            <Detail label="Object Namespace" value={event.regardingNamespace || event.namespace || "-"} />
            <Detail label="Action" value={event.action || "-"} />
            <Detail label="Controller" value={event.reportingController || "-"} />
            <Detail label="Count" value={String(event.count)} />
            <Detail label="Event Time" value={formatEventTime(event.eventTime)} />
            <Detail label="First Seen" value={formatEventTime(event.firstTimestamp)} />
            <Detail label="Last Seen" value={formatEventTime(event.lastTimestamp)} />
            <Detail label="Name" value={event.name} className="sm:col-span-2" />
          </section>
        )}
      </div>
    </BottomPanel>
  );
}

function Detail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-foreground">{value || "-"}</dd>
    </div>
  );
}

function eventFromObject(object: Record<string, unknown>): ClusterEvent | null {
  const metadata = record(object.metadata);
  const name = text(metadata.name);
  if (!name) return null;
  const regarding = record(object.regarding);
  const series = record(object.series);
  const eventTime = text(object.eventTime);
  const firstTimestamp = text(object.deprecatedFirstTimestamp) || eventTime;
  const lastTimestamp = text(series.lastObservedTime) || text(object.deprecatedLastTimestamp) || eventTime;
  return {
    name,
    namespace: text(metadata.namespace),
    type: text(object.type) || "Normal",
    reason: text(object.reason),
    note: text(object.note),
    action: text(object.action),
    regardingKind: text(regarding.kind),
    regardingName: text(regarding.name),
    regardingNamespace: text(regarding.namespace),
    reportingController: text(object.reportingController),
    count: numberValue(series.count) || numberValue(object.deprecatedCount) || 1,
    eventTime,
    firstTimestamp,
    lastTimestamp,
    age: ageFromTimestamp(lastTimestamp)
  };
}

function eventKey(event: ClusterEvent) {
  return `${event.namespace ?? ""}/${event.name}`;
}

function compareEvents(a: ClusterEvent, b: ClusterEvent, key: SortKey, direction: SortDirection) {
  const aValue = key === "count" ? a.count : a[key] ?? "";
  const bValue = key === "count" ? b.count : b[key] ?? "";
  const result =
    typeof aValue === "number" && typeof bValue === "number"
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue));
  return direction === "asc" ? result : -result;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function ageFromTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatEventTime(value: string) {
  if (!value) return "-";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString();
}
