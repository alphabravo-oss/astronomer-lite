import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";

export type MetricChartRow = {
  label: string;
  fullName: string;
  cpu: number;
  memory: number;
};

type MetricChartProps = {
  title: string;
  rows: MetricChartRow[];
  dataKey: "cpu" | "memory";
  unit: "m" | "bytes";
  empty: string;
};

export function MetricChart({ title, rows, dataKey, unit, empty }: MetricChartProps) {
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

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {rows.length > 0 ? (
        <div ref={chartRef} className="h-72 min-h-72 min-w-0 p-4">
          {chartWidth > 0 ? (
            <BarChart data={rows} width={chartWidth} height={256} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis
                type="number"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value) => (unit === "bytes" ? shortBytes(Number(value)) : String(value))}
                stroke="hsl(var(--border))"
              />
              <YAxis
                type="category"
                dataKey="label"
                width={112}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                stroke="hsl(var(--border))"
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.45)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as MetricChartRow;
                  const value = Number(payload[0].value ?? 0);
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-xl">
                      <div className="mb-1 font-mono text-foreground">{row.fullName}</div>
                      <div className="text-muted-foreground">{unit === "bytes" ? formatBytes(value) : formatCPU(value)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
                {rows.map((row) => (
                  <Cell key={row.fullName} fill={metricColor(row, dataKey)} />
                ))}
              </Bar>
            </BarChart>
          ) : null}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div>
      )}
    </section>
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

function shortBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}G`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)}M`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)}K`;
  return String(value);
}

function metricColor(row: MetricChartRow, dataKey: "cpu" | "memory") {
  if (dataKey === "cpu") {
    if (row.cpu >= 1000) return "#f59e0b";
    return "hsl(var(--primary))";
  }
  if (row.memory >= 1024 ** 3) return "#f59e0b";
  return "#10b981";
}
