// ============================================================
// 548 / Playoff Pulse — module components
// SeriesCard, BracketView, ProbabilityTable, TeamStrengthTable,
// AssumptionsPanel, MethodologySection
// ============================================================

const { Fragment } = React;

// ─── SeriesCard ──────────────────────────────────────────────
function SeriesCard({ s, variant = "full" }) {
  const A = window.PP.T[s.a];
  const B = window.PP.T[s.b];
  const homeNext = s.nextGame.at;
  return (
    <div className="col bd-2" style={{ background: 'var(--panel)' }}>
      {/* head */}
      <div className="row ac jb sec-head" style={{ background: 'var(--bg)', color: 'var(--yellow)', borderBottom: '2px solid var(--ink)' }}>
        <div className="row ac gap-8">
          <span className="ix">{s.conf}{s.conf === 'E' ? '·SEMI' : '·SEMI'}</span>
          <span>SERIES · GAME {s.scoreA + s.scoreB + 1}</span>
        </div>
        <div className="row ac gap-6">
          <span className="dotmark sm" style={{ background: 'var(--red)', borderColor: 'var(--red-2)' }} />
          <span className="f-pix t-9 uc">{s.status}</span>
        </div>
      </div>

      {/* scorestrip */}
      <div className="row ac" style={{ padding: '14px 14px', gap: 14, background: 'linear-gradient(180deg, var(--panel-2), var(--panel))', borderBottom: '2px solid var(--gray-sep)' }}>
        <div className="col ac gap-6" style={{ minWidth: 84 }}>
          <TeamBadge team={s.a} size="lg" />
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{A.conf}{A.seed} · HOME</div>
        </div>

        <div className="col grow ac gap-6">
          <div className="row ac gap-12">
            <span className="prob-num lg" style={{ color: s.scoreA > s.scoreB ? 'var(--green-2)' : 'var(--ink)' }}>{s.scoreA}</span>
            <span className="f-pix t-14 uc" style={{ color: 'var(--ink-dim)' }}>—</span>
            <span className="prob-num lg" style={{ color: s.scoreB > s.scoreA ? 'var(--green-2)' : 'var(--ink)' }}>{s.scoreB}</span>
          </div>
          <div className="row ac gap-6">
            <DotSeries wins={s.scoreA} color="w" total={4} />
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>BO7</span>
            <DotSeries wins={s.scoreB} color="w" total={4} />
          </div>
        </div>

        <div className="col ac gap-6" style={{ minWidth: 84 }}>
          <TeamBadge team={s.b} size="lg" />
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{B.conf}{B.seed} · AWAY</div>
        </div>
      </div>

      {/* next game */}
      <div className="row" style={{ padding: '10px 14px', gap: 14, borderBottom: '2px solid var(--gray-sep)', background: 'var(--bg-2)' }}>
        <div className="col gap-2">
          <div className="f-pix t-9 uc" style={{ color: 'var(--yellow)' }}>NEXT · G{s.nextGame.num}</div>
          <div className="f-pix t-11 uc">{s.nextGame.date}</div>
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{s.nextGame.time}</div>
        </div>
        <div className="col gap-2 grow">
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>AT</div>
          <div className="row ac gap-6"><TeamBadge team={homeNext} size="sm" /><span className="f-pix t-10 uc">HOME · +2.5</span></div>
          <div className="f-term t-14 uc" style={{ color: 'var(--ink-mute)' }}>{window.PP.T[homeNext].name.toUpperCase()}</div>
        </div>
      </div>

      {/* probability rows */}
      <div className="col" style={{ padding: '12px 14px', gap: 10, borderBottom: '2px solid var(--gray-sep)' }}>
        <div className="col gap-4">
          <div className="row ac jb">
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>NEXT GAME WIN PROB</span>
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>MODEL EST.</span>
          </div>
          <div className="row ac gap-8">
            <TeamBadge team={s.a} size="sm" />
            <div className="grow"><ProbBar p={s.pNextA} tone="" /></div>
            <ProbNum value={s.pNextA} size="sm" />
          </div>
          <div className="row ac gap-8">
            <TeamBadge team={s.b} size="sm" />
            <div className="grow"><ProbBar p={s.pNextB} tone="warn" /></div>
            <ProbNum value={s.pNextB} size="sm" />
          </div>
        </div>

        <div className="divider" style={{ background: 'var(--gray-sep)' }} />

        <div className="col gap-4">
          <div className="row ac jb">
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SERIES WIN PROB</span>
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>BO7 · SIM</span>
          </div>
          <div className="row ac gap-8">
            <TeamBadge team={s.a} size="sm" />
            <div className="grow"><ProbBar p={s.pSeriesA} tone="" size="lg" /></div>
            <ProbNum value={s.pSeriesA} size="md" tone="good" />
          </div>
          <div className="row ac gap-8">
            <TeamBadge team={s.b} size="sm" />
            <div className="grow"><ProbBar p={s.pSeriesB} tone="danger" size="lg" /></div>
            <ProbNum value={s.pSeriesB} size="md" tone="bad" />
          </div>
        </div>
      </div>

      {/* margins + adj */}
      <div className="row" style={{ padding: '10px 14px', gap: 10, borderBottom: '2px solid var(--gray-sep)' }}>
        <div className="col gap-2 grow">
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>EXP MARGIN</div>
          <div className="row ac gap-6">
            <TeamBadge team={s.expMargin.team} size="sm" />
            <span className="f-pix t-14" style={{ color: 'var(--yellow)' }}>+{s.expMargin.value.toFixed(1)}</span>
          </div>
        </div>
        <div className="col gap-2 grow">
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>CONFIDENCE</div>
          <SigBars level={Math.abs(s.pSeriesA - 0.5) > 0.2 ? 4 : Math.abs(s.pSeriesA - 0.5) > 0.1 ? 3 : 2} />
        </div>
        <div className="col gap-2 grow">
          <div className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SHIFT VS YDAY</div>
          <span className="f-pix t-14" style={{ color: s.conf_pct_change >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>
            {s.conf_pct_change >= 0 ? '+' : ''}{(s.conf_pct_change*100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* manual note */}
      <div className="row ac gap-8" style={{ padding: '10px 14px', background: 'rgba(245, 216, 71, 0.06)' }}>
        <span className="pill warn">MANUAL ADJ</span>
        <span className="f-term t-14" style={{ color: 'var(--ink)' }}>{s.manual}</span>
      </div>
    </div>
  );
}

// ─── BracketView ─────────────────────────────────────────────
// Two conferences side-by-side. Champion in middle.
function MatchSlot({ a, b, sA, sB, winner, status = "done", small = false }) {
  // status: done | live | upcoming
  const A = a ? window.PP.T[a] : null;
  const B = b ? window.PP.T[b] : null;
  const aBg = status === 'done' && winner === a ? 'var(--panel-2)' : 'var(--bg-2)';
  const bBg = status === 'done' && winner === b ? 'var(--panel-2)' : 'var(--bg-2)';
  const aColor = winner === a ? 'var(--green-2)' : status === 'live' ? 'var(--ink)' : 'var(--ink-mute)';
  const bColor = winner === b ? 'var(--green-2)' : status === 'live' ? 'var(--ink)' : 'var(--ink-mute)';
  return (
    <div className="col bd-2-dim" style={{ background: 'var(--bg-2)', minWidth: small ? 132 : 156, flexShrink: 0 }}>
      <div className="row ac jb" style={{ background: aBg, padding: '6px 8px', borderBottom: '1px solid var(--gray-sep)' }}>
        <div className="row ac gap-6">
          {A ? [
            <span key="s" className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)', width: 10 }}>{A.seed}</span>,
            <TeamBadge key="b" team={a} size="sm" />,
            <span key="a" className="f-pix t-9 uc" style={{ color: aColor }}>{A.abbr}</span>,
          ] : (
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>— TBD —</span>
          )}
        </div>
        <span className="f-pix t-11" style={{ color: aColor }}>{sA != null ? sA : '·'}</span>
      </div>
      <div className="row ac jb" style={{ background: bBg, padding: '6px 8px' }}>
        <div className="row ac gap-6">
          {B ? [
            <span key="s" className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)', width: 10 }}>{B.seed}</span>,
            <TeamBadge key="b" team={b} size="sm" />,
            <span key="a" className="f-pix t-9 uc" style={{ color: bColor }}>{B.abbr}</span>,
          ] : (
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>— TBD —</span>
          )}
        </div>
        <span className="f-pix t-11" style={{ color: bColor }}>{sB != null ? sB : '·'}</span>
      </div>
      {status === 'live' && (
        <div className="row ac jc" style={{ background: 'var(--yellow)', color: 'var(--on-accent)', padding: '2px 4px' }}>
          <span className="f-pix" style={{ fontSize: 8, letterSpacing: 1 }}>· LIVE ·</span>
        </div>
      )}
    </div>
  );
}

function BracketView({ compact = false }) {
  const D = window.PP;
  // East bracket data
  const E_R1 = [
    { a: "CLE", b: "MIA", sA: 4, sB: 1, w: "CLE" },
    { a: "MIL", b: "ORL", sA: 4, sB: 2, w: "MIL" },
    { a: "NYK", b: "IND", sA: 4, sB: 3, w: "NYK" },
    { a: "BOS", b: "PHI", sA: 4, sB: 0, w: "BOS" },
  ];
  const E_R2 = [
    { a: "CLE", b: "MIL", sA: 2, sB: 1, w: null, status: "live" },
    { a: "BOS", b: "NYK", sA: 2, sB: 1, w: null, status: "live" },
  ];
  const W_R1 = [
    { a: "OKC", b: "PHX", sA: 4, sB: 0, w: "OKC" },
    { a: "HOU", b: "LAL", sA: 4, sB: 3, w: "HOU" },
    { a: "MIN", b: "MEM", sA: 4, sB: 2, w: "MIN" },
    { a: "DEN", b: "DAL", sA: 4, sB: 1, w: "DEN" },
  ];
  const W_R2 = [
    { a: "OKC", b: "HOU", sA: 1, sB: 2, w: null, status: "live" },
    { a: "DEN", b: "MIN", sA: 2, sB: 2, w: null, status: "live" },
  ];

  const colGap = compact ? 16 : 28;

  const ColTitle = ({ t, sub, color, align = 'left' }) => (
    <div className="col gap-4" style={{ marginBottom: 8, textAlign: align, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <div className="f-pix t-10 uc" style={{ color: color || 'var(--yellow)', letterSpacing: 1.5 }}>{t}</div>
      <div className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>{sub}</div>
    </div>
  );

  // bracket column with matches stacked w/ even spacing
  function Column({ matches, status, gaps = [12,12,12,12], small }) {
    return (
      <div className="col" style={{ justifyContent: 'space-around', gap: 12 }}>
        {matches.map((m, i) => (
          <MatchSlot key={i} a={m.a} b={m.b} sA={m.sA} sB={m.sB} winner={m.w} status={m.status || status} small={small} />
        ))}
      </div>
    );
  }

  // CF placeholder
  const cfSlot = (label) => (
    <div className="col bd-2-dim" style={{ background: 'var(--bg-2)', minWidth: 156, flexShrink: 0 }}>
      <div className="row ac jc" style={{ background: 'var(--bg-2)', padding: '6px 8px', borderBottom: '1px solid var(--gray-sep)' }}>
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>— TBD —</span>
      </div>
      <div className="row ac jc" style={{ background: 'var(--bg-2)', padding: '6px 8px' }}>
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>— TBD —</span>
      </div>
      <div className="row ac jc" style={{ background: 'var(--gray-sep)', padding: '2px 4px' }}>
        <span className="f-pix" style={{ fontSize: 8, letterSpacing: 1, color: 'var(--ink-dim)' }}>{label}</span>
      </div>
    </div>
  );

  // championship slot (center) — aligned grid of contenders
  const contenders = [
    { t: "BOS", p: 24.6 },
    { t: "CLE", p: 21.8 },
    { t: "DEN", p: 9.2 },
    { t: "OKC", p: 8.4 },
  ];
  const maxP = Math.max(...contenders.map(c => c.p));
  const champ = (
    <div className="col bd-hard ac" style={{ background: 'var(--bg)', padding: '20px 18px', minWidth: 188, gap: 10 }}>
      <span className="f-pix t-10 uc" style={{ color: 'var(--yellow)', letterSpacing: 1.5 }}>NBA FINALS</span>
      <div className="row gap-6 ac">
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>EAST</span>
        <span className="f-pix t-9" style={{ color: 'var(--ink-mute)' }}>VS</span>
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>WEST</span>
      </div>
      <div className="divider ink" style={{ width: '100%', height: 2 }} />
      <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>CHAMPION</span>
      <span className="prob-num lg" style={{ color: 'var(--yellow)', lineHeight: 1 }}>?</span>
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '38px 1fr 46px',
          alignItems: 'center',
          columnGap: 10,
          rowGap: 8,
          marginTop: 2,
        }}
      >
        {contenders.map((c) => (
          <React.Fragment key={c.t}>
            <div style={{ justifySelf: 'start' }}>
              <TeamBadge team={c.t} size="sm" />
            </div>
            <div
              style={{
                height: 12,
                background: 'var(--bg-2)',
                border: '2px solid var(--ink)',
                borderRadius: 3,
                overflow: 'hidden',
                boxShadow: 'inset 0 0 0 1px var(--bg)',
                padding: 0,
              }}
            >
              <div
                style={{
                  width: `${c.p}%`,
                  height: '100%',
                  background: 'var(--yellow)',
                  borderRight: c.p > 2 && c.p < 98 ? '2px solid var(--ink)' : 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <span
              className="f-term"
              style={{
                fontSize: 12,
                color: 'var(--ink)',
                justifySelf: 'end',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: 0,
                fontWeight: 600,
              }}
            >
              {c.p.toFixed(1)}%
            </span>
          </React.Fragment>
        ))}
      </div>
      <span className="f-pix" style={{ fontSize: 8, color: 'var(--ink-mute)', marginTop: 4, letterSpacing: 1 }}>TOP 4 BY MODEL</span>
    </div>
  );

  return (
    <div className="col" style={{ padding: 16, background: 'var(--bg)' }}>
      <div className="row" style={{ gap: colGap, alignItems: 'stretch' }}>
        {/* EAST */}
        <div className="col grow" style={{ gap: 8 }}>
          <div className="row ac gap-12">
            <span className="pill cyan">EASTERN CONFERENCE</span>
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SEMIS · 2/4 LIVE</span>
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'stretch' }}>
            <div className="col grow gap-6">
              <ColTitle t="R1" sub="1ST ROUND · DONE" />
              <Column matches={E_R1} status="done" small={compact} />
            </div>
            <div className="col grow gap-6" style={{ justifyContent: 'space-around' }}>
              <ColTitle t="R2" sub="CONF SEMIS · LIVE" color="var(--green-2)" />
              <div className="col" style={{ flex: 1, justifyContent: 'space-around', gap: 80 }}>
                {E_R2.map((m, i) => (
                  <MatchSlot key={i} a={m.a} b={m.b} sA={m.sA} sB={m.sB} winner={null} status="live" small={compact} />
                ))}
              </div>
            </div>
            <div className="col grow gap-6" style={{ justifyContent: 'flex-start' }}>
              <ColTitle t="CF" sub="CONF FINALS · TBD" />
              <div className="col" style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-start' }}>
                {cfSlot("E · CF · TBD")}
              </div>
            </div>
          </div>
        </div>

        {/* CHAMP */}
        <div className="col" style={{ alignSelf: 'center' }}>
          {champ}
        </div>

        {/* WEST */}
        <div className="col grow" style={{ gap: 8 }}>
          <div className="row ac gap-12 je">
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SEMIS · 2/4 LIVE</span>
            <span className="pill cyan">WESTERN CONFERENCE</span>
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'stretch', flexDirection: 'row-reverse' }}>
            <div className="col grow gap-6">
              <ColTitle t="R1" sub="1ST ROUND · DONE" align="right" />
              <Column matches={W_R1} status="done" small={compact} />
            </div>
            <div className="col grow gap-6" style={{ justifyContent: 'space-around' }}>
              <ColTitle t="R2" sub="CONF SEMIS · LIVE" color="var(--green-2)" align="right" />
              <div className="col" style={{ flex: 1, justifyContent: 'space-around', gap: 80 }}>
                {W_R2.map((m, i) => (
                  <MatchSlot key={i} a={m.a} b={m.b} sA={m.sA} sB={m.sB} winner={null} status="live" small={compact} />
                ))}
              </div>
            </div>
            <div className="col grow gap-6">
              <ColTitle t="CF" sub="CONF FINALS · TBD" align="right" />
              <div className="col" style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-end' }}>
                {cfSlot("W · CF · TBD")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ProbabilityTable ─────────────────────────────────────────
function heatClass(v) {
  if (v >= 0.30) return 'h6';
  if (v >= 0.20) return 'h5';
  if (v >= 0.10) return 'h4';
  if (v >= 0.05) return 'h3';
  if (v >  0)    return 'h2';
  return 'h0';
}

function ProbabilityTable({ rows = window.PP.probs }) {
  return (
    <table className="pp-table">
      <thead>
        <tr>
          <th>RK</th>
          <th>TEAM</th>
          <th>NAME</th>
          <th className="num">CONF F</th>
          <th className="num">FINALS</th>
          <th className="num">CHAMP</th>
          <th>COVERAGE</th>
          <th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice().sort((a,b) => b.champ - a.champ).map((r, i) => {
          const T = window.PP.T[r.team];
          const elim = r.status === 'ELIM';
          // round coverage: round1 done by all, round2 done by alive teams
          // For demo: alive teams that are in semis -> done=1, live in R2 (so live=true at index 1)
          const round = elim ? 1 : 1;
          return (
            <tr key={r.team} className={elim ? 'elim' : ''}>
              <td style={{ color: 'var(--ink-mute)' }}>{i + 1}</td>
              <td><TeamBadge team={r.team} size="sm" /></td>
              <td className="f-term t-16" style={{ color: elim ? 'var(--ink-mute)' : 'var(--ink)' }}>{T.name.toUpperCase()} <span style={{ color: 'var(--ink-mute)' }}>· {T.conf}{T.seed}</span></td>
              <td className="num">{elim ? <span className="heat h0">—</span> : <span className={`heat ${heatClass(r.cf)}`}>{(r.cf*100).toFixed(1)}</span>}</td>
              <td className="num">{elim ? <span className="heat h0">—</span> : <span className={`heat ${heatClass(r.fin)}`}>{(r.fin*100).toFixed(1)}</span>}</td>
              <td className="num">{elim ? <span className="heat h0">—</span> : <span className={`heat ${heatClass(r.champ)}`}>{(r.champ*100).toFixed(1)}</span>}</td>
              <td><Coverage done={round} live={!elim} elim={elim} /></td>
              <td>
                {elim
                  ? <span className="pill bad">ELIMINATED</span>
                  : <span className="pill good">LIVE</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── TeamStrengthTable ───────────────────────────────────────
function TeamStrengthTable({ rows = window.PP.strength }) {
  return (
    <table className="pp-table">
      <thead>
        <tr>
          <th>RK</th>
          <th>TEAM</th>
          <th className="num">PIM<br /><span style={{ color: 'var(--ink-mute)', fontSize: 7 }}>×0.40</span></th>
          <th className="num">NET<br /><span style={{ color: 'var(--ink-mute)', fontSize: 7 }}>×0.30</span></th>
          <th className="num">ELO<br /><span style={{ color: 'var(--ink-mute)', fontSize: 7 }}>×0.20</span></th>
          <th className="num">MAN<br /><span style={{ color: 'var(--ink-mute)', fontSize: 7 }}>×0.10</span></th>
          <th className="num">STR</th>
          <th>SCALE</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice().sort((a,b) => b.str - a.str).map((r, i) => {
          const T = window.PP.T[r.team];
          const heat = r.str >= 9 ? 'h6' : r.str >= 8.5 ? 'h5' : r.str >= 8 ? 'h4' : r.str >= 7.5 ? 'h3' : 'h2';
          return (
            <tr key={r.team}>
              <td style={{ color: 'var(--ink-mute)' }}>{i + 1}</td>
              <td><div className="row ac gap-6"><TeamBadge team={r.team} size="sm" /><span className="f-term t-16">{T.name.toUpperCase()}</span></div></td>
              <td className="num"><span className={`heat ${r.pim >= 9 ? 'h5' : r.pim >= 8 ? 'h3' : 'h2'}`}>{r.pim.toFixed(1)}</span></td>
              <td className="num"><span className={`heat ${r.net >= 9 ? 'h5' : r.net >= 8 ? 'h3' : 'h2'}`}>{r.net.toFixed(1)}</span></td>
              <td className="num"><span className={`heat ${r.elo >= 8.7 ? 'h5' : r.elo >= 8 ? 'h3' : 'h2'}`}>{r.elo.toFixed(1)}</span></td>
              <td className="num"><span className="heat h1" style={{ color: r.man > 0 ? 'var(--green-2)' : r.man < 0 ? 'var(--red-2)' : 'var(--ink-mute)' }}>{r.man > 0 ? '+' : ''}{r.man.toFixed(1)}</span></td>
              <td className="num"><span className={`heat ${heat}`}>{r.str.toFixed(2)}</span></td>
              <td>
                <div className="probbar sm" style={{ width: 90 }}>
                  {Array.from({ length: 10 }).map((_, k) => (
                    <div key={k} className={`cell ${k < Math.round(r.str) ? 'on' : ''}`} />
                  ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── AssumptionsPanel ────────────────────────────────────────
function AssumptionsPanel() {
  const A = window.PP.assumptions;
  return (
    <div className="col bd-2" style={{ background: 'var(--panel)' }}>
      <WarningStrip kind="red">MANUAL DATA · MODEL ESTIMATES · NOT BETTING ADVICE</WarningStrip>
      <div className="col" style={{ padding: 14, gap: 10 }}>
        <div className="row ac jb">
          <div className="f-pix t-11 uc" style={{ color: 'var(--yellow)' }}>ASSUMPTIONS</div>
          <span className="pill warn">8 ACTIVE</span>
        </div>
        <div className="col gap-6">
          {A.map((a, i) => (
            <div key={i} className="row gap-8" style={{ alignItems: 'flex-start' }}>
              <span className="f-pix t-9 uc" style={{ color: 'var(--yellow)', minWidth: 24, marginTop: 2 }}>A·{String(i+1).padStart(2,'0')}</span>
              <span className="f-term t-16" style={{ color: 'var(--ink)' }}>{a}</span>
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="row gap-8 ac">
          <PixelButton variant="ghost">READ METHODOLOGY →</PixelButton>
          <PixelButton variant="cyan">VIEW RAW INPUTS</PixelButton>
        </div>
      </div>
    </div>
  );
}

// ─── MethodologySection ──────────────────────────────────────
function MethodologySection() {
  const sections = [
    {
      tag: "01",
      title: "TEAM STRENGTH FORMULA",
      body: "Each team gets a single scalar STR rating on a roughly 0–10 scale. STR is a weighted blend of four inputs: player-minute impact (PIM, 40%), regular-season net rating (NET, 30%), Elo-derived value (ELO, 20%), and a hand-set manual adjustment (MAN, 10%). The manual term exists so an analyst can encode information the other inputs can't see — recent rotation changes, injury severity, locker-room noise — without secretly fudging the underlying signals.",
    },
    {
      tag: "02",
      title: "PLAYER-MINUTE WEIGHTING",
      body: "Player-minute impact starts from each player's regular-season on-court net rating, then weighted by projected playoff minutes. We currently set those minutes manually rather than reading from a contract or rotation feed. That means coaching changes between regular-season and playoffs are reflected, but only if an analyst has updated the table.",
    },
    {
      tag: "03",
      title: "INJURY HANDLING",
      body: "Each injury status maps to a fixed multiplier on that player's minutes: OUT = 0.0, DOUBTFUL = 0.20, QUESTIONABLE = 0.55, PROBABLE = 0.90, FULL = 1.00. Mid-series upgrades require a manual re-run. If a player is QUESTIONABLE and gets ruled out 30 minutes before tip-off, the dashboard will be wrong until the next refresh.",
    },
    {
      tag: "04",
      title: "HOME COURT",
      body: "Home court is a flat +2.5 points added to the home team's expected scoring margin per game. We do not currently model travel fatigue, altitude, back-to-backs, or rest mismatches. This is the single largest source of model error in tight series — a +2.5 constant is a known under-fit.",
    },
    {
      tag: "05",
      title: "MONTE CARLO SIMULATION",
      body: "We translate STR into per-game expected margins, draw a single-game outcome from a normal distribution around that margin (σ ≈ 11 points, fit on the prior 3 seasons), and replay each remaining series 20,000 times. Series-level probabilities are the share of branches that end in each team's favor.",
    },
    {
      tag: "06",
      title: "BRACKET SIMULATION",
      body: "The bracket sim runs every active series forward through Conference Finals and the NBA Finals. Branches re-use the same STR ratings (no propagation of fatigue or learning between rounds). Reported Conference Finals / Finals / Championship probabilities are conditional on current series scores plus model assumptions.",
    },
    {
      tag: "07",
      title: "LIMITATIONS",
      body: "This is a MANUAL, STATIC MVP. There is no live ingest. There is no automatic injury feed. There is no playoff-specific calibration. There is no Bayesian update from in-series performance. The model will be wrong, sometimes by a lot — especially in series where strength differences are small and home court is doing most of the work. Treat probabilities as a structured summary of explicit assumptions, not as a prediction.",
    },
  ];
  return (
    <div className="col bd-2" style={{ background: 'var(--panel)' }}>
      <div className="sec-head row ac jb" style={{ background: 'var(--bg)', color: 'var(--yellow)', borderBottom: '2px solid var(--ink)' }}>
        <div className="row ac gap-8"><span className="ix">M</span><span>METHODOLOGY</span></div>
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>v0.3.1 · 7 SECTIONS</span>
      </div>
      <div className="col" style={{ padding: 16, gap: 14 }}>
        <div className="f-term t-20" style={{ color: 'var(--ink)', maxWidth: 720 }}>
          How the model works, what it doesn't see, and what it assumes you'll let it get away with. Every input is documented; every input can be wrong.
        </div>
        <div className="divider ink" />
        <div className="col gap-12">
          {sections.map((s, i) => (
            <div key={s.tag} className="col gap-6">
              <div className="row ac gap-10">
                <span className="ix" style={{ background: 'var(--yellow)', color: 'var(--on-accent)', padding: '4px 7px', fontFamily: 'var(--f-pixel)', fontSize: 'var(--t-10)' }}>{s.tag}</span>
                <span className="f-pix t-12 uc" style={{ color: 'var(--ink)', letterSpacing: 1.5 }}>{s.title}</span>
              </div>
              <div className="f-term t-20" style={{ color: 'var(--ink-dim)', maxWidth: 820, lineHeight: 1.35, paddingLeft: 38 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  SeriesCard, BracketView, ProbabilityTable, TeamStrengthTable,
  AssumptionsPanel, MethodologySection,
});
