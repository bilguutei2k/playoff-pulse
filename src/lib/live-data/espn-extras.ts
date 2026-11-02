// Display-only details from ESPN's scoreboard that the engine does not need: venue
// and broadcast. Parsed leniently, because a missing arena name should never break a
// page; anything unexpected is simply left out.

type Json = Record<string, unknown>;

export type GameExtras = {
  venue: string | null;
  city: string | null;
  /** National broadcasts when there are any, else local ones, at most two. */
  broadcast: string | null;
};

function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseScoreboardExtras(payload: unknown): Record<string, GameExtras> {
  const output: Record<string, GameExtras> = {};
  for (const raw of list(record(payload)?.events)) {
    const event = record(raw);
    const id = text(event?.id);
    const competition = record(list(event?.competitions)[0]);
    if (!id || !competition) continue;
    const venue = record(competition.venue);
    const address = record(venue?.address);
    const city = text(address?.city);
    const state = text(address?.state);
    const national: string[] = [];
    const local: string[] = [];
    for (const item of list(competition.broadcasts)) {
      const row = record(item);
      // League Pass is every game's out-of-market stream, not a broadcast worth naming.
      const names = list(row?.names)
        .map(text)
        .filter((name): name is string => name !== null && !/league pass/i.test(name));
      (text(row?.market) === "national" ? national : local).push(...names);
    }
    const names = [...new Set(national.length > 0 ? national : local)].slice(0, 2);
    output[id] = {
      venue: text(venue?.fullName),
      city: city && state ? `${city}, ${state}` : city,
      broadcast: names.length > 0 ? names.join(", ") : null,
    };
  }
  return output;
}
