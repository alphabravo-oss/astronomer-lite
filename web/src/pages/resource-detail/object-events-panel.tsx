import { QueryState } from "../../components/ui/query-state";
import { RefreshCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { StatusBadge } from "../../components/ui/status-badge";
import type { ClusterEvent } from "../../lib/api";
import { cn, formatAge } from "../../lib/utils";

export function ObjectEventsPanel({
  events,
  loading,
  error,
  onRefresh,
}: {
  events: ClusterEvent[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Events</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kubernetes events related to this object.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCcw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>
      {error ? <QueryState error={error} /> : null}
      <div className="overflow-x-auto">
        <table className="k8s-table">
          <thead className="k8s-thead">
            <tr>
              <th className="k8s-th">Type</th>
              <th className="k8s-th">Reason</th>
              <th className="k8s-th">Message</th>
              <th className="k8s-th">Age</th>
              <th className="k8s-th">Count</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr
                key={`${event.namespace ?? "_cluster"}/${event.name}`}
                className="border-t border-border"
              >
                <td className="px-4 py-3">
                  <StatusBadge
                    status={event.type === "Warning" ? "warning" : "reachable"}
                    label={event.type || "Normal"}
                    pulse={false}
                  />
                </td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {event.reason || "-"}
                </td>
                <td className="max-w-md px-4 py-3 text-muted-foreground">
                  {event.note || event.action || "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {event.age ||
                    formatAge(event.lastTimestamp || event.eventTime) ||
                    "-"}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {event.count}
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-muted-foreground"
                  colSpan={5}
                >
                  {loading
                    ? "Loading events..."
                    : "No events found for this object."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
