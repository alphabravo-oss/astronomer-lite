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
