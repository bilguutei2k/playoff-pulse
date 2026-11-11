// Where a day lives and which typed dates lead somewhere. Pure; tests in
// tests/view-filters.test.ts.

import { isEtDate } from "@/lib/utils/dates";

/** Today is the homepage; any other ET date is its archive page. */
export function dayHref(etDate: string, today: string): string {
  return etDate === today ? "/" : `/games/${etDate}`;
}

/**
 * A date typed or picked in the days row's date control, when it is a real calendar date
 * within the stored season; null otherwise, so a half-typed year never navigates.
 */
export function jumpDate(value: string, first: string, last: string): string | null {
  if (!isEtDate(value)) return null;
  return value >= first && value <= last ? value : null;
}
