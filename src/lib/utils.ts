import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function headers2Record(headers: Headers) {
  const res: Record<string, string> = {};
  headers.forEach((value, key) => {
    res[key] = value;
  });
  return res;
}
