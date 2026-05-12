import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

export type RangeSeries = {
  /** Stable identifier for the series (used as the Recharts dataKey). */
  key: string;
  /** Friendly label shown in legend and tooltip. */
  label: string;
  /** Points keyed by timestamp seconds; matched against the chart's domain. */
  points: Array<[number, number]>;
};

type RangeChartProps = {
  title: string;
  subtitle?: string;
  series: RangeSeries[];
  unit: "cpu-cores" | "bytes" | "raw";
  empty: string;
  /** When true, renders a shimmer placeholder. */
  loading?: boolean;
};

type ChartRow = {
  ts: number;
} & Record<string, number | undefined>;

const SERIES_COLORS = [
  "hsl(var(--primary))",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#84cc16",
  "#f97316"
];

export function RangeChart({ title, subtitle, series, unit, empty, loading = false }: RangeChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () => setChartWidth(Math.max(0, element.clientWidth - 32));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo<ChartRow[]>(() => mergeSeries(series), [series]);
  const hasData = series.some((s) => s.points.length > 0);

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
      </div>
      {loading && !hasData ? (
        <div className="shimmer h-72 bg-muted/40" />
      ) : hasData ? (
        <div ref={chartRef} className="h-72 min-h-72 min-w-0 p-4">
          {chartWidth > 0 ? (
            <LineChart data={rows} width={chartWidth} height={256} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tickFormatter={formatTime}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                stroke="hsl(var(--border))"
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value) => formatValue(Number(value), unit, true)}
                stroke="hsl(var(--border))"
                width={64}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted) / 0.6)" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const ts = typeof label === "number" ? label : Number(label);
                  const sorted = [...payload].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-xl">
                      <div className="mb-1 font-mono text-foreground">{formatTimestamp(ts)}</div>
                      <div className="space-y-0.5">
                        {sorted.map((entry) => {
                          const seriesItem = series.find((s) => s.key === entry.dataKey);
                          const display = seriesItem?.label ?? String(entry.dataKey);
                          return (
                            <div key={String(entry.dataKey)} className="flex items-center gap-2 text-muted-foreground">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ background: String(entry.color ?? "#888") }} />
                              <span className="truncate font-mono text-foreground">{display}</span>
                              <span className="ml-auto tabular-nums">{formatValue(Number(entry.value ?? 0), unit, false)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
              />
              {series.length > 1 ? (
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => {
                    const item = series.find((s) => s.key === value);
                    return <span className="text-muted-foreground">{item?.label ?? value}</span>;
                  }}
                />
              ) : null}
              {series.map((s, index) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : null}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div>
      )}
    </section>
  );
}

function mergeSeries(series: RangeSeries[]): ChartRow[] {
  if (series.length === 0) return [];
  const buckets = new Map<number, ChartRow>();
  for (const s of series) {
    for (const [ts, value] of s.points) {
      let row = buckets.get(ts);
      if (!row) {
        row = { ts };
        buckets.set(ts, row);
      }
      row[s.key] = value;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value * 1000);
  return date.toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "numeric" });
}

function formatValue(value: number, unit: RangeChartProps["unit"], compact: boolean): string {
  if (!Number.isFinite(value)) return "-";
  if (unit === "cpu-cores") {
    if (value >= 1) return `${value.toFixed(compact ? 1 : 2)}`;
    if (value >= 0.001) return `${(value * 1000).toFixed(compact ? 0 : 1)}m`;
    return value.toFixed(compact ? 2 : 4);
  }
  if (unit === "bytes") {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(compact ? 1 : 2)}${compact ? "G" : " GiB"}`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(compact ? 0 : 1)}${compact ? "M" : " MiB"}`;
    if (value >= 1024) return `${(value / 1024).toFixed(compact ? 0 : 1)}${compact ? "K" : " KiB"}`;
    return `${value.toFixed(0)}${compact ? "" : " B"}`;
  }
  return compact ? value.toFixed(2) : value.toString();
}
