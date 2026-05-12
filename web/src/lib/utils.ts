import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function gaugeColor(percentage: number): string {
  if (percentage >= 90) return "bg-status-error";
  if (percentage >= 75) return "bg-status-warning";
  return "bg-status-success";
}

export function gaugeTextColor(percentage: number): string {
  if (percentage >= 90) return "text-status-error";
  if (percentage >= 75) return "text-status-warning";
  return "text-status-success";
}

export function formatCPU(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} cores`;
  return `${value}m`;
}

export function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

export function formatAge(value: string): string {
  if (!value) return "";
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

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}
