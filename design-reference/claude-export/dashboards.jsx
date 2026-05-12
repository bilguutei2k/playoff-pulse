// ============================================================
// 548 / Playoff Pulse — full screen layouts (desktop + mobile)
// ============================================================

// ─── Desktop Dashboard ───────────────────────────────────────
function DesktopDashboard() {
  return (
    <div className="pp-frame col" data-screen-label="Desktop Dashboard">
      <ScoreboardHeader />
      <ModelStatusStrip />
      <WarningStrip kind="yellow">
        MVP · MANUAL DATA · INPUTS LAST EDITED 5/17 11:02 AM ET · NOT A LIVE FEED · ASSUMPTIONS PANEL BELOW
      </WarningStrip>

      <div className="col" style={{ padding: 18, gap: 18, background: 'var(--bg)' }}>

        {/* KPI ROW */}
        <div className="row gap-12">
          <RetroPanel ix="01" title="MODEL ESTIMATE · CHAMPIONSHIP" tone="dark" style={{ flex: 2 }}>
            <div className="row" style={{ padding: 14, gap: 16, alignItems: 'stretch' }}>
              {[{t:"BOS",p:0.246},{t:"CLE",p:0.218},{t:"DEN",p:0.092},{t:"OKC",p:0.084},{t:"HOU",p:0.072},{t:"MIN",p:0.068}].map(x => (
                <div key={x.t} className="col grow gap-6 ac" style={{ padding: 8, border: '1px solid var(--gray-sep)', background: 'var(--bg-2)' }}>
                  <TeamBadge team={x.t} size="md" />
                  <ProbNum value={x.p} size="lg" />
                  <div style={{ width: '100%' }}><ProbBar p={x.p / 0.30} tone={x.p >= 0.20 ? '' : x.p >= 0.10 ? 'warn' : 'danger'} size="sm" /></div>
                </div>
              ))}
            </div>
          </RetroPanel>

          <RetroPanel ix="02" title="TITLE ODDS SHIFT · 7-DAY" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 8 }}>
              {[
                { t: "HOU", v: +0.031, note: "BEAT OKC G3" },
                { t: "BOS", v: +0.022, note: "NYK · BRUNSON Q" },
                { t: "OKC", v: -0.038, note: "1-2 IN R2" },
                { t: "MIL", v: +0.011, note: "LILLARD UPGRADE" },
              ].map(x => (
                <div key={x.t} className="row ac gap-8">
                  <TeamBadge team={x.t} size="sm" />
                  <div className="grow f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{x.note}</div>
                  <span className="f-pix t-12" style={{ color: x.v >= 0 ? 'var(--green-2)' : 'var(--red-2)', minWidth: 56, textAlign: 'right' }}>{x.v >= 0 ? '+' : ''}{(x.v*100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </RetroPanel>
        </div>

        {/* BRACKET */}
        <RetroPanel ix="03" title="FULL BRACKET · POSTSEASON 2026" tone="dark" scan
          right={<span className="row ac gap-8" style={{ display: 'inline-flex' }}>
            <span className="pill good">R1 · DONE</span>
            <span className="pill warn">R2 · LIVE</span>
            <span className="pill">CF · TBD</span>
            <span className="pill">F · TBD</span>
            <span className="kbd">⏎ FOCUS</span>
          </span>}>
          <BracketView />
        </RetroPanel>

        {/* ACTIVE SERIES + TIME LANE */}
        <div className="row gap-12 as">
          <RetroPanel ix="04" title="ACTIVE SERIES · CONF SEMIS" tone="dark"
            right={<span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>4 LIVE</span>}
            style={{ flex: 1 }}>
            <div className="row" style={{ padding: 12, gap: 12, flexWrap: 'wrap' }}>
              {window.PP.semis.map((s) => (
                <div key={s.a + s.b} style={{ flex: '1 1 calc(50% - 6px)', minWidth: 380 }}>
                  <SeriesCard s={s} />
                </div>
              ))}
            </div>
          </RetroPanel>
        </div>

        {/* TABLES ROW */}
        <div className="row gap-12 as">
          <RetroPanel ix="05" title="PROBABILITY TABLE · CF / FIN / CHAMP" tone="dark" style={{ flex: 1.4, minWidth: 0 }}>
            <ProbabilityTable />
          </RetroPanel>
          <RetroPanel ix="06" title="TEAM STRENGTH · TOP 8" tone="dark" style={{ flex: 1, minWidth: 0 }}>
            <TeamStrengthTable />
          </RetroPanel>
        </div>

        {/* ASSUMPTIONS + METHODOLOGY LINK */}
        <div className="row gap-12 as">
          <div style={{ flex: 1 }}>
            <AssumptionsPanel />
          </div>
          <RetroPanel ix="07" title="WHAT THE MODEL CAN'T SEE" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 10 }}>
              {[
                { k: "LIVE INJURIES", v: "NO FEED · MANUAL ENTRY" },
                { k: "REST / TRAVEL", v: "NOT MODELED" },
                { k: "ROTATION CHANGES MID-SERIES", v: "REQUIRES ANALYST RE-RUN" },
                { k: "REFEREE / OFFICIATING TENDENCY", v: "NOT MODELED" },
                { k: "IN-SERIES BAYESIAN UPDATE", v: "PLANNED · v0.4" },
                { k: "LIVE LINE-UP DATA", v: "PLANNED · v0.5" },
              ].map((x, i) => (
                <div key={i} className="row ac jb" style={{ borderBottom: '1px solid var(--gray-sep)', paddingBottom: 6 }}>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink)' }}>{x.k}</span>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--yellow)' }}>{x.v}</span>
                </div>
              ))}
              <div className="row gap-8" style={{ marginTop: 4 }}>
                <PixelButton variant="yellow">OPEN METHODOLOGY →</PixelButton>
                <PixelButton variant="ghost">EXPORT INPUTS (CSV)</PixelButton>
              </div>
            </div>
          </RetroPanel>
        </div>
      </div>

      {/* FOOTER STRIP */}
      <div className="row ac jb" style={{ background: 'var(--bg-2)', borderTop: '4px solid var(--ink)', padding: '10px 18px' }}>
        <div className="row ac gap-12">
          <div className="sb-logo" style={{ background: 'var(--ink)', color: 'var(--bg)', padding: '4px 8px', fontSize: 'var(--t-12)' }}>548</div>
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>PLAYOFF PULSE · MODEL v0.3.1 · BUILD 2026.05.17-1102</span>
        </div>
        <div className="row ac gap-12">
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>NOT BETTING ADVICE · NOT AFFILIATED W/ NBA</span>
          <span className="kbd">M</span>
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>METHODOLOGY</span>
          <span className="kbd">A</span>
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>ASSUMPTIONS</span>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile Dashboard ─────────────────────────────────────────
function MobileDashboard() {
  const semis = window.PP.semis;
  return (
    <div className="pp-frame col" style={{ background: 'var(--bg)' }} data-screen-label="Mobile Dashboard">
      {/* compact scoreboard */}
      <div className="col" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--hairline-2)' }}>
        <div className="row ac jb" style={{ padding: '10px 12px' }}>
          <div className="row ac gap-8">
            <div className="sb-logo" style={{ padding: '6px 8px', fontSize: 'var(--t-14)' }}>548</div>
            <div className="col" style={{ gap: 2 }}>
              <span className="f-pix t-9 uc" style={{ color: 'var(--ink)' }}>PLAYOFF PULSE</span>
              <span className="f-pix" style={{ fontSize: 7, color: 'var(--ink-dim)' }}>FORECASTING ENGINE</span>
            </div>
          </div>
          <div className="row ac gap-6">
            <span className="sb-blink" />
            <span className="f-pix t-9 uc" style={{ color: 'var(--yellow)' }}>v0.3.1</span>
          </div>
        </div>
        <div className="row" style={{ background: 'var(--bg-2)', padding: '6px 10px', borderTop: '2px solid var(--gray-sep)' }}>
          <span className="f-pix t-9 uc" style={{ color: 'var(--yellow)' }}>2026 · CONF SEMIS</span>
          <span className="grow" />
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>D14 · 12:48 ET</span>
        </div>
      </div>

      {/* warning */}
      <div style={{ padding: 0 }}>
        <WarningStrip kind="yellow">MANUAL DATA · MODEL EST · NOT BETTING ADVICE</WarningStrip>
      </div>

      {/* tabs */}
      <div className="row" style={{ background: 'var(--bg-2)', borderBottom: '2px solid var(--gray-sep)' }}>
        {[
          { k: "DASH", on: true },
          { k: "BRKT", on: false },
          { k: "TBL", on: false },
          { k: "WHY", on: false },
        ].map(t => (
          <div key={t.k} className="row jc grow" style={{
            padding: '10px 0',
            background: t.on ? 'var(--panel-2)' : 'transparent',
            borderBottom: t.on ? '3px solid var(--yellow)' : '3px solid transparent',
          }}>
            <span className="f-pix t-10 uc" style={{ color: t.on ? 'var(--ink)' : 'var(--ink-dim)' }}>{t.k}</span>
          </div>
        ))}
      </div>

      <div className="col" style={{ padding: 10, gap: 12 }}>
        {/* champ summary */}
        <div className="col bd-2" style={{ background: 'var(--panel)' }}>
          <div className="sec-head dark"><span className="ix">01</span><span>TITLE ODDS · TOP 4</span></div>
          <div className="col" style={{ padding: 10, gap: 8 }}>
            {[{t:"BOS",p:0.246},{t:"CLE",p:0.218},{t:"DEN",p:0.092},{t:"OKC",p:0.084}].map(x => (
              <div key={x.t} className="row ac gap-8">
                <TeamBadge team={x.t} size="sm" />
                <div className="grow"><ProbBar p={x.p / 0.30} tone={x.p >= 0.20 ? '' : x.p >= 0.10 ? 'warn' : 'danger'} /></div>
                <ProbNum value={x.p} size="sm" />
              </div>
            ))}
            <span className="f-pix" style={{ fontSize: 7, color: 'var(--ink-mute)' }}>BAR SCALED TO 30% · CHAMPIONSHIP %</span>
          </div>
        </div>

        {/* coverage strip */}
        <div className="col bd-2" style={{ background: 'var(--panel)' }}>
          <div className="sec-head dark"><span className="ix">02</span><span>ROUND COVERAGE</span></div>
          <div className="col" style={{ padding: 10, gap: 7 }}>
            {["BOS","CLE","DEN","OKC","HOU","MIN","MIL","NYK"].map(t => (
              <div key={t} className="row ac gap-8">
                <TeamBadge team={t} size="sm" />
                <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)', minWidth: 64 }}>{window.PP.T[t].name.split(' ').slice(-1)[0].toUpperCase()}</span>
                <span className="grow" />
                <Coverage done={1} live elim={false} />
              </div>
            ))}
            <div className="divider" />
            {["MIA","ORL","IND","PHI","PHX","LAL","MEM","DAL"].map(t => (
              <div key={t} className="row ac gap-8">
                <TeamBadge team={t} size="sm" />
                <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)', minWidth: 64 }}>{window.PP.T[t].name.split(' ').slice(-1)[0].toUpperCase()}</span>
                <span className="grow" />
                <Coverage done={1} elim />
              </div>
            ))}
          </div>
        </div>

        {/* active series compact */}
        <div className="col bd-2" style={{ background: 'var(--panel)' }}>
          <div className="sec-head dark"><span className="ix">03</span><span>ACTIVE SERIES · 4 LIVE</span></div>
          <div className="col">
            {semis.map((s, i) => (
              <div key={i} className="col" style={{ padding: 10, gap: 8, borderBottom: i < semis.length - 1 ? '2px solid var(--gray-sep)' : 'none' }}>
                <div className="row ac jb">
                  <div className="row ac gap-6"><TeamBadge team={s.a} size="sm" /><span className="f-pix t-11">{s.scoreA}</span><span className="f-pix t-9" style={{ color: 'var(--ink-mute)' }}>—</span><span className="f-pix t-11">{s.scoreB}</span><TeamBadge team={s.b} size="sm" /></div>
                  <span className="pill warn">G{s.nextGame.num} · {s.nextGame.date.split(' ')[0]}</span>
                </div>
                <div className="row ac gap-6">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)', minWidth: 48 }}>SERIES</span>
                  <div className="grow"><ProbBar p={s.pSeriesA} tone="" /></div>
                </div>
                <div className="row ac jb">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--green-2)' }}>{s.a} {(s.pSeriesA*100).toFixed(1)}%</span>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--red-2)' }}>{s.b} {(s.pSeriesB*100).toFixed(1)}%</span>
                </div>
                <div className="row ac gap-6">
                  <span className="pill warn">MANUAL</span>
                  <span className="f-term t-14" style={{ color: 'var(--ink-dim)', lineHeight: 1.2 }}>{s.manual}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* assumptions abbreviated */}
        <div className="col bd-2" style={{ background: 'var(--panel)' }}>
          <WarningStrip kind="red">ASSUMPTIONS · 8 ACTIVE</WarningStrip>
          <div className="col" style={{ padding: 10, gap: 6 }}>
            {window.PP.assumptions.slice(0, 4).map((a, i) => (
              <div key={i} className="row gap-6" style={{ alignItems: 'flex-start' }}>
                <span className="f-pix" style={{ fontSize: 8, color: 'var(--yellow)', marginTop: 2, minWidth: 26 }}>A·{String(i+1).padStart(2,'0')}</span>
                <span className="f-term t-14" style={{ color: 'var(--ink)', lineHeight: 1.2 }}>{a}</span>
              </div>
            ))}
            <PixelButton variant="ghost" style={{ marginTop: 4, alignSelf: 'flex-start' }}>SEE ALL 8 →</PixelButton>
          </div>
        </div>

      </div>

      {/* bottom nav */}
      <div className="row" style={{ background: 'var(--bg-2)', borderTop: '4px solid var(--ink)' }}>
        {[
          { k: "DASH", on: true },
          { k: "BRKT", on: false },
          { k: "TBL", on: false },
          { k: "METH", on: false },
        ].map(t => (
          <div key={t.k} className="col grow ac jc" style={{
            padding: '10px 0', gap: 4,
            background: t.on ? 'var(--panel-2)' : 'transparent',
          }}>
            <div style={{ width: 14, height: 14, background: t.on ? 'var(--yellow)' : 'var(--gray-mid)', border: '1px solid var(--ink)' }} />
            <span className="f-pix" style={{ fontSize: 8, color: t.on ? 'var(--yellow)' : 'var(--ink-dim)' }}>{t.k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DesktopDashboard, MobileDashboard });
