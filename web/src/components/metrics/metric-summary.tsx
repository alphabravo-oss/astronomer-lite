import { Cpu, HardDrive } from "lucide-react";
import type { ReactNode } from "react";
import type { MetricsRow } from "../../lib/api";
import { cn } from "../../lib/utils";

type MetricSummaryProps = {
  title: string;
  metric?: MetricsRow | null;
  unavailable?: string;
};

export function MetricSummary({ title, metric, unavailable }: MetricSummaryProps) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {metric?.timestamp ? <p className="mt-1 text-xs text-muted-foreground">Last sample {new Date(metric.timestamp).toLocaleTimeString()}</p> : null}
      </div>
      {metric ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricTile
            label="CPU"
            value={formatCPU(metric.cpu)}
            percentage={metric.cpuPercent}
            icon={<Cpu className="h-4 w-4" />}
          />
          <MetricTile
            label="Memory"
            value={formatBytes(metric.memory)}
            percentage={metric.memoryPercent}
            icon={<HardDrive className="h-4 w-4" />}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{unavailable || "Metrics are not available for this resource."}</p>
      )}
    </section>
  );
}

function MetricTile({
  label,
  value,
  percentage,
  icon
}: {
  label: string;
  value: string;
  percentage?: number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
      </div>
      {percentage !== undefined ? (
        <div className="mt-3">
          <div className="gauge-bar">
            <div className={cn("gauge-bar-fill", gaugeBarColor(percentage))} style={{ width: `${Math.min(100, percentage)}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{percentage.toFixed(1)}%</div>
        </div>
      ) : null}
    </div>
  );
}

function formatCPU(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} cores`;
  return `${value}m`;
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function gaugeBarColor(percentage: number) {
  if (percentage >= 90) return "bg-status-error";
  if (percentage >= 75) return "bg-status-warning";
  return "bg-status-success";
}
