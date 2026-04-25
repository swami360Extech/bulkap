import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  // Always render in UTC so date-only values (stored as UTC midnight/noon) don't shift day across timezones
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(date));
}

export function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|[\s_-])(\w)/g, (_, c) => " " + c.toUpperCase()).trim();
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "text-emerald-600";
  if (confidence >= 0.8) return "text-amber-500";
  return "text-red-500";
}

export function confidenceBadge(confidence: number): "success" | "warning" | "destructive" {
  if (confidence >= 0.9) return "success";
  if (confidence >= 0.8) return "warning";
  return "destructive";
}
