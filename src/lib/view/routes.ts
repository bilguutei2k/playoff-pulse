// Every internal link to a team, a game, a player or a day goes through one of these,
// so a URL shape changes in one place. Display only.
//
//   SITE_URL                the production origin (metadataBase, sitemap, robots)
//   teamHref(teamId)        "/teams/min"   (ESPN team ID in, team page out)
//   gameHref(gameId)        "/game/401809"
//   playerHref(athleteId)   "/players/3945274"
//   dayHref(etDate, today)  "/" for today, "/games/2026-11-08" otherwise

/** The production origin, without a trailing slash. */
export const SITE_URL = "https://548-sable.vercel.app";

export { teamHref } from "@/lib/view/teams";
export { playerHref } from "@/lib/view/players";
export { dayHref } from "@/lib/view/day-nav";

/** A game's page: `/game/{gameId}` (the ESPN event ID). */
export function gameHref(gameId: string): string {
  return `/game/${gameId}`;
}
