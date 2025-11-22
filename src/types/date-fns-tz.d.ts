// src/types/date-fns-tz.d.ts

declare module 'date-fns-tz' {
  // Minimal signatures we actually use.

  export function zonedTimeToUtc(
    date: string | number | Date,
    timeZone: string
  ): Date;

  export function utcToZonedTime(
    date: string | number | Date,
    timeZone: string
  ): Date;

  export function formatInTimeZone(
    date: string | number | Date,
    timeZone: string,
    formatString: string
  ): string;
}
