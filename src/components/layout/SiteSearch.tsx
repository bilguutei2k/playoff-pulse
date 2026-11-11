"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchIndexResponse } from "@/app/api/search-index/route";
import { signalNavigationStart } from "@/components/layout/NavProgress";
import {
  prepareTeams,
  preparePlayers,
  searchPlayers,
  searchTeamList,
  searchTeams,
  splitSpan,
  type PreparedPlayer,
  type SearchTeam,
} from "@/components/layout/site-search-match";
import { TeamLogo } from "@/components/live/TeamLogo";
import { playerHref } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";

/**
 * The masthead's quick finder (NAV-26 / DS-25). Mounted once in Header.tsx; one trigger
 * serves every width: a 44px icon button on phones, icon plus "Search" from 1024px.
 * "/" opens it from anywhere except while typing in a field.
 *
 * A modal <dialog> holds an ARIA 1.2 combobox: focus stays in the input, the arrow keys
 * move the active option (aria-activedescendant; the first result is active as you
 * type), Enter opens it (Cmd/Ctrl+Enter in a new tab), Escape or Close closes the
 * dialog and focus returns to the trigger. Every option is a real link, so a click,
 * middle click or modified click behaves like any link. Results are grouped Teams, then
 * Players. The 30 teams are bundled; the player list (id, name, team) comes from
 * /api/search-index the first time the finder opens, never with the page.
 */

const PREPARED_TEAMS = prepareTeams(searchTeamList());
const EXAMPLES = ["Thunder", "LAL", "Portland", "Jokić"];
const TEAM_LIMIT = 6;
const PLAYER_LIMIT = 8;

type PlayerLoad =
  | { state: "idle" | "loading" | "error" }
  | { state: "ready"; players: PreparedPlayer[] };

// One request per page load, shared by every open of the finder.
let playerRequest: Promise<PreparedPlayer[]> | null = null;
function loadPlayers(): Promise<PreparedPlayer[]> {
  playerRequest ??= fetch("/api/search-index")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<SearchIndexResponse>;
    })
    .then((body) => preparePlayers(Array.isArray(body.players) ? body.players : []))
    .catch((error: unknown) => {
      playerRequest = null;
      throw error;
    });
  return playerRequest;
}

type Option =
  | { kind: "team"; key: string; href: string; team: SearchTeam; span: [number, number] | null; codeHit: boolean }
  | { kind: "player"; key: string; href: string; id: string; name: string; teamId: string; span: [number, number] | null }
  | { kind: "more"; key: string; href: string; total: number };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function Highlight({ text, span }: { text: string; span: [number, number] | null }) {
  const [before, hit, after] = splitSpan(text, span);
  if (!hit) return <>{text}</>;
  return (
    <>
      {before}
      <mark className="ss-hit">{hit}</mark>
      {after}
    </>
  );
}

export function SiteSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const savedOverflow = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [players, setPlayers] = useState<PlayerLoad>({ state: "idle" });

  const listId = `${ids}-list`;
  const titleId = `${ids}-title`;
  const helpId = `${ids}-help`;
  const optionId = (index: number) => `${ids}-opt-${index}`;

  const fetchPlayers = useCallback(() => {
    setPlayers({ state: "loading" });
    loadPlayers().then(
      (list) => setPlayers({ state: "ready", players: list }),
      () => setPlayers({ state: "error" }),
    );
  }, []);

  const openFinder = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    savedOverflow.current = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    setOpen(true);
    if (players.state === "idle" || players.state === "error") fetchPlayers();
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [players.state, fetchPlayers]);

  const closeFinder = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);

  // The dialog's close event (Escape, Close, a chosen result, the backdrop) lands here.
  const onDialogClose = useCallback(() => {
    setOpen(false);
    if (savedOverflow.current !== null) {
      document.documentElement.style.overflow = savedOverflow.current;
      savedOverflow.current = null;
    }
    triggerRef.current?.focus();
  }, []);

  // "/" opens the finder unless the visitor is typing somewhere or another dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      openFinder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFinder]);

  // A navigation by any route (Back while open, a chosen result) closes it.
  useEffect(() => {
    closeFinder();
  }, [pathname, closeFinder]);

  // Leaving the page with the finder open must not leave the page unscrollable.
  useEffect(
    () => () => {
      if (savedOverflow.current !== null) document.documentElement.style.overflow = savedOverflow.current;
    },
    [],
  );

  const { options, teamCount, playerCount, playerTotal } = useMemo(() => {
    const teams = searchTeams(PREPARED_TEAMS, query, TEAM_LIMIT);
    const found =
      players.state === "ready" ? searchPlayers(players.players, query, PLAYER_LIMIT) : { results: [], total: 0 };
    const list: Option[] = [
      ...teams.map(
        (hit): Option => ({
          kind: "team",
          key: `t${hit.team.id}`,
          href: hit.team.href,
          team: hit.team,
          span: hit.nameSpan,
          codeHit: hit.codeHit,
        }),
      ),
      ...found.results.map(
        (hit): Option => ({
          kind: "player",
          key: `p${hit.player.id}`,
          href: playerHref(hit.player.id),
          id: hit.player.id,
          name: hit.player.name,
          teamId: hit.player.team,
          span: hit.span,
        }),
      ),
    ];
    if (found.total > found.results.length) {
      const params = new URLSearchParams({ q: query.trim(), min: "0" });
      list.push({ kind: "more", key: "more", href: `/players?${params}`, total: found.total });
    }
    return { options: list, teamCount: teams.length, playerCount: found.results.length, playerTotal: found.total };
  }, [query, players]);

  const activeIndex = options.length ? Math.min(active, options.length - 1) : -1;
  const trimmed = query.trim();

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${ids}-opt-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, ids]);

  const choose = (option: Option, newTab: boolean) => {
    if (newTab) {
      window.open(option.href, "_blank", "noopener");
      return;
    }
    closeFinder();
    signalNavigationStart();
    router.push(option.href);
  };

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      if (activeIndex < 0) return;
      event.preventDefault();
      choose(options[activeIndex], event.metaKey || event.ctrlKey);
    }
  };

  // A plain click on a result: the link navigates, the finder closes. Modified clicks
  // (new tab or window) leave it open.
  const onOptionClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    closeFinder();
  };

  const loadingPlayers = players.state === "loading" || players.state === "idle";
  let status = "";
  if (trimmed) {
    if (!options.length && !loadingPlayers) status = `No team or player matches ${trimmed}.`;
    else {
      const parts = [`${teamCount} ${teamCount === 1 ? "team" : "teams"}`];
      if (players.state === "ready") parts.push(`${playerTotal} ${playerTotal === 1 ? "player" : "players"}`);
      status = `${parts.join(" and ")}. Use the up and down arrow keys to choose, Enter to open.`;
    }
  }

  const renderOption = (option: Option, index: number) => {
    const selected = index === activeIndex;
    const common = {
      id: optionId(index),
      role: "option" as const,
      "aria-selected": selected,
      tabIndex: -1,
      href: option.href,
      prefetch: false,
      className: `ss-option${option.kind === "more" ? " ss-option-more" : ""}`,
      onClick: onOptionClick,
      onMouseMove: () => {
        if (!selected) setActive(index);
      },
    };
    if (option.kind === "team") {
      return (
        <Link key={option.key} {...common}>
          <TeamLogo teamId={option.team.id} size={24} />
          <span className="ss-option-name">
            <Highlight text={option.team.name} span={option.span} />
          </span>
          <span className="ss-option-meta" aria-hidden="true">
            {option.codeHit ? <mark className="ss-hit">{option.team.code}</mark> : option.team.code}
          </span>
        </Link>
      );
    }
    if (option.kind === "player") {
      const team = teamDisplay(option.teamId);
      return (
        <Link key={option.key} {...common}>
          <span className="ss-option-name">
            <Highlight text={option.name} span={option.span} />
            <span className="sr-only">, {team.name}</span>
          </span>
          <span className="ss-option-meta" aria-hidden="true">
            <TeamLogo teamId={option.teamId} size={18} />
            {team.code}
          </span>
        </Link>
      );
    }
    return (
      <Link key={option.key} {...common}>
        <span className="ss-option-name">
          All {option.total} players matching &ldquo;{trimmed}&rdquo; on the players page
        </span>
        <span className="ss-option-meta" aria-hidden="true">
          &rarr;
        </span>
      </Link>
    );
  };

  const teamOptions = options.slice(0, teamCount);
  const playerOptions = options.slice(teamCount);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openFinder}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="/"
        title="Search teams and players (press /)"
        className="inline-flex h-11 min-w-11 flex-none items-center justify-center gap-2 px-2 text-[15px] font-semibold text-white decoration-2 underline-offset-[9px] hover:underline hover:decoration-white/50"
      >
        <Search aria-hidden="true" size={20} strokeWidth={2.25} />
        <span className="sr-only lg:not-sr-only">Search</span>
      </button>
      <dialog
        ref={dialogRef}
        className="ss-dialog"
        aria-labelledby={titleId}
        onClose={onDialogClose}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself, never on the panel.
          if (event.target === event.currentTarget) closeFinder();
        }}
      >
        <div className="ss-panel">
          <h2 id={titleId} className="sr-only">
            Search teams and players
          </h2>
          <div className="ss-bar">
            <Search aria-hidden="true" size={20} className="ss-bar-icon" />
            <input
              ref={inputRef}
              className="ss-input"
              type="text"
              role="combobox"
              aria-label="Team or player"
              aria-autocomplete="list"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-describedby={helpId}
              placeholder="Team or player"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={60}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
            />
            <button type="button" className="ss-close" onClick={closeFinder}>
              Close
            </button>
          </div>
          <p id={helpId} className="sr-only">
            Type a team&apos;s city, nickname or abbreviation, or any part of a player&apos;s name. Results appear as
            you type.
          </p>
          <div className="ss-results">
            {!trimmed ? (
              <>
                <p className="ss-message">
                  Find a team by city, nickname or abbreviation, or a player by any part of his name.
                </p>
                <div className="ss-examples" aria-label="Examples">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="ss-example"
                      onClick={() => {
                        setQuery(example);
                        setActive(0);
                        inputRef.current?.focus();
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {trimmed && !options.length && !loadingPlayers ? (
              <p className="ss-message">
                No team or player matches <strong>&ldquo;{trimmed}&rdquo;</strong>. Check the spelling, or browse{" "}
                <Link href="/teams" className="pp-link" onClick={onOptionClick}>
                  all teams
                </Link>{" "}
                and{" "}
                <Link href="/players" className="pp-link" onClick={onOptionClick}>
                  all players
                </Link>
                .
              </p>
            ) : null}
            <div id={listId} role="listbox" aria-label="Results" hidden={!options.length}>
              {teamOptions.length ? (
                <div role="group" aria-labelledby={`${ids}-g-teams`}>
                  <div id={`${ids}-g-teams`} role="presentation" className="ss-group-label">
                    Teams
                  </div>
                  {teamOptions.map((option, index) => renderOption(option, index))}
                </div>
              ) : null}
              {playerOptions.length ? (
                <div role="group" aria-labelledby={`${ids}-g-players`}>
                  <div id={`${ids}-g-players`} role="presentation" className="ss-group-label">
                    Players
                  </div>
                  {playerOptions.map((option, index) => renderOption(option, teamCount + index))}
                </div>
              ) : null}
            </div>
            {trimmed && loadingPlayers ? <p className="ss-status">Loading players&hellip;</p> : null}
            {trimmed && players.state === "error" ? (
              <p className="ss-status">
                Players could not be loaded.{" "}
                <button type="button" className="ss-retry" onClick={fetchPlayers}>
                  Try again
                </button>
              </p>
            ) : null}
            {trimmed && players.state === "ready" && playerCount === 0 && teamCount > 0 ? (
              <p className="ss-status">No player matches.</p>
            ) : null}
          </div>
          <p className="ss-keys" aria-hidden="true">
            <span>
              <kbd>&uarr;</kbd>
              <kbd>&darr;</kbd>to move
            </span>
            <span>
              <kbd>Enter</kbd>to open
            </span>
            <span>
              <kbd>Esc</kbd>to close
            </span>
          </p>
          <p role="status" className="sr-only">
            {status}
          </p>
        </div>
      </dialog>
    </>
  );
}
