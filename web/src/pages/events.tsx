import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { BottomPanel } from "../components/ui/bottom-panel";
import { Button } from "../components/ui/button";
import { PageHeader, PageShell } from "../components/ui/page";
import { SearchInput } from "../components/ui/search-input";
import {
  SortableHeader,
  type SortDirection,
} from "../components/ui/sortable-header";
import { useWatch } from "../hooks/use-watch";
import type { ClusterEvent, WatchFrame } from "../lib/api";
import { api } from "../lib/api";
import { cn, formatAge, record, text } from "../lib/utils";

type EventsPageProps = {
  selectedNamespaces: string[];
};

type SortKey =
  | "lastTimestamp"
  | "namespace"
  | "type"
  | "reason"
  | "regardingKind"
  | "count";

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
    gvr: {
      group: "events.k8s.io",
      version: "v1",
      resource: "events",
      kind: "Event",
      namespaced: true,
    },
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
        const index = current.findIndex((item) => eventKey(item) === key);
        if (frame.type === "DELETED") {
          if (index < 0) return current;
          const next = current.slice();
          next.splice(index, 1);
          return next;
        }
        if (index < 0) return [...current, event];
        if (sameEventRow(current[index], event)) return current;
        const next = current.slice();
        next[index] = event;
        return next;
      });
    },
  });

  const eventTypes = useMemo(
    () => uniqueValues(events.map((event) => event.type).filter(Boolean)),
    [events],
  );
  const regardingKinds = useMemo(
    () =>
      uniqueValues(events.map((event) => event.regardingKind).filter(Boolean)),
    [events],
  );

  const visibleEvents = useMemo(() => {
    const search = query.trim().toLowerCase();
    return events
      .filter((event) => typeFilter === "all" || event.type === typeFilter)
      .filter(
        (event) => kindFilter === "all" || event.regardingKind === kindFilter,
      )
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
          event.reportingController,
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
    <PageShell>
      <PageHeader
        title="Events"
        description={
          selectedNamespaces.length === 0
            ? "Newest Kubernetes events across all namespaces."
            : `Newest Kubernetes events filtered to ${selectedNamespaces.join(", ")}.`
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => void loadEvents()}
            disabled={loading}
          >
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center">
        <SearchInput
          className="min-w-0 flex-1"
          id="event-search"
          name="event-search"
          value={query}
          onValueChange={setQuery}
          placeholder="Search events"
        />
        <select
          id="event-type-filter"
          name="event-type-filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
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
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
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

      <div className="text-xs uppercase text-muted-foreground">
        Watch: {watchStatus}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="k8s-table">
          <thead className="k8s-thead">
            <tr>
              <SortableHeader
                label="Last seen"
                sortKey="lastTimestamp"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Namespace"
                sortKey="namespace"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Type"
                sortKey="type"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Reason"
                sortKey="reason"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Object"
                sortKey="regardingKind"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <th className="k8s-th">Message</th>
              <SortableHeader
                label="Count"
                sortKey="count"
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((event) => (
              <tr
                key={eventKey(event)}
                className="table-row-hover k8s-row"
                onClick={() => setSelectedEvent(event)}
              >
                <td className="k8s-td-muted whitespace-nowrap">
                  {event.age || formatEventTime(event.lastTimestamp)}
                </td>
                <td className="k8s-td-muted">{event.namespace || "-"}</td>
                <td className="k8s-td">
                  <Badge
                    tone={event.type === "Warning" ? "warning" : "success"}
                  >
                    {event.type || "Normal"}
                  </Badge>
                </td>
                <td className="k8s-td-name">{event.reason || "-"}</td>
                <td className="k8s-td max-w-64">
                  <div className="truncate">{event.regardingName || "-"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {event.regardingKind || "Object"}
                  </div>
                </td>
                <td className="k8s-td-muted max-w-[28rem] truncate">
                  {event.note || event.action || "-"}
                </td>
                <td className="k8s-td-numeric">{event.count}</td>
              </tr>
            ))}
            {visibleEvents.length === 0 ? (
              <tr>
                <td
                  className="bg-card px-4 py-8 text-center text-muted-foreground"
                  colSpan={7}
                >
                  {loading ? "Loading events..." : "No events found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {selectedEvent ? (
        <EventDrawer
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      ) : null}
    </PageShell>
  );
}

function EventDrawer({
  event,
  onClose,
}: {
  event: ClusterEvent;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("message");

  return (
    <BottomPanel
      open
      onClose={onClose}
      title={event.reason || event.name}
      subtitle={`${event.namespace || "cluster"} / ${event.type || "Normal"}`}
      tabs={[
        { key: "message", label: "Message" },
        { key: "details", label: "Details" },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      <div className="h-full overflow-y-auto p-4">
        {activeTab === "message" ? (
          <section className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={event.type === "Warning" ? "warning" : "success"}>
                {event.type || "Normal"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {event.namespace || "cluster"}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {event.note || event.action || "No message recorded."}
            </p>
          </section>
        ) : (
          <section className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm sm:grid-cols-2">
            <Detail
              label="Object"
              value={`${event.regardingKind || "Object"}/${event.regardingName || "-"}`}
            />
            <Detail
              label="Object Namespace"
              value={event.regardingNamespace || event.namespace || "-"}
            />
            <Detail label="Action" value={event.action || "-"} />
            <Detail
              label="Controller"
              value={event.reportingController || "-"}
            />
            <Detail label="Count" value={String(event.count)} />
            <Detail
              label="Event Time"
              value={formatEventTime(event.eventTime)}
            />
            <Detail
              label="First Seen"
              value={formatEventTime(event.firstTimestamp)}
            />
            <Detail
              label="Last Seen"
              value={formatEventTime(event.lastTimestamp)}
            />
            <Detail label="Name" value={event.name} className="sm:col-span-2" />
          </section>
        )}
      </div>
    </BottomPanel>
  );
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words font-mono text-xs text-foreground">
        {value || "-"}
      </dd>
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
  const lastTimestamp =
    text(series.lastObservedTime) ||
    text(object.deprecatedLastTimestamp) ||
    eventTime;
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
    count:
      numberValue(series.count) || numberValue(object.deprecatedCount) || 1,
    eventTime,
    firstTimestamp,
    lastTimestamp,
    age: formatAge(lastTimestamp),
  };
}

function sameEventRow(a: ClusterEvent, b: ClusterEvent) {
  return (
    a.type === b.type &&
    a.reason === b.reason &&
    a.note === b.note &&
    a.action === b.action &&
    a.count === b.count &&
    a.lastTimestamp === b.lastTimestamp &&
    a.regardingKind === b.regardingKind &&
    a.regardingName === b.regardingName
  );
}

function eventKey(event: ClusterEvent) {
  return `${event.namespace ?? ""}/${event.name}`;
}

function compareEvents(
  a: ClusterEvent,
  b: ClusterEvent,
  key: SortKey,
  direction: SortDirection,
) {
  const aValue = key === "count" ? a.count : (a[key] ?? "");
  const bValue = key === "count" ? b.count : (b[key] ?? "");
  const result =
    typeof aValue === "number" && typeof bValue === "number"
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue));
  return direction === "asc" ? result : -result;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatEventTime(value: string) {
  if (!value) return "-";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString();
}
