// ============================================================
// 548 / Playoff Pulse — Style Guide artboard
// ============================================================

function StyleGuide() {
  const swatch = (name, varname, sub, dark = false) => (
    <div className="col bd-2" style={{ background: `var(${varname})`, minWidth: 130 }}>
      <div style={{ height: 76 }} />
      <div className="col" style={{ background: 'var(--bg)', padding: '6px 8px', borderTop: '2px solid var(--ink)' }}>
        <span className="f-pix t-10 uc" style={{ color: 'var(--ink)' }}>{name}</span>
        <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{varname}</span>
        {sub && <span className="f-pix" style={{ fontSize: 8, color: 'var(--yellow)' }}>{sub}</span>}
      </div>
    </div>
  );

  return (
    <div className="pp-frame col" style={{ background: 'var(--bg)' }} data-screen-label="Style Guide">
      <ScoreboardHeader subtitle="DESIGN TOKENS · v0.3.1 · DESIGN-SYSTEM REFERENCE" />

      <div className="col" style={{ padding: 22, gap: 20 }}>

        {/* COLORS */}
        <RetroPanel ix="01" title="COLOR · SCOREBOARD PALETTE" tone="dark">
          <div className="col" style={{ padding: 14, gap: 12 }}>
            <div className="f-pix t-10 uc" style={{ color: 'var(--ink-dim)' }}>SURFACES</div>
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              {swatch("BG",          "--bg",       "BASE")}
              {swatch("BG-2",        "--bg-2",     "RECESS")}
              {swatch("PANEL",       "--panel",    "DARK")}
              {swatch("PANEL-TURF",  "--panel-2",  "MID")}
              {swatch("PANEL-LIT",   "--panel-3",  "LIT")}
              {swatch("STAT",        "--stat",     "STAT BG")}
              {swatch("STAT-2",      "--stat-2",   "STAT MID")}
              {swatch("COURT",       "--court",    "HARDWOOD")}
            </div>
            <div className="f-pix t-10 uc" style={{ color: 'var(--ink-dim)', marginTop: 8 }}>INK & ACCENTS</div>
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              {swatch("INK",         "--ink",      "BROADCAST WHT")}
              {swatch("INK-DIM",     "--ink-dim",  "SECONDARY")}
              {swatch("INK-MUTE",    "--ink-mute", "TERTIARY")}
              {swatch("YELLOW",      "--yellow",   "ACCENT")}
              {swatch("STAT-3",      "--stat-3",   "CYAN HI")}
              {swatch("GREEN",       "--green",    "GOOD")}
              {swatch("RED",         "--red",      "WARN/BAD")}
              {swatch("GRAY-SEP",    "--gray-sep", "SEPARATOR")}
            </div>
            <div className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>4 SURFACES · 2 INK · 3 ACCENT · 1 WARNING · KEEP IT NES-SMALL.</div>
          </div>
        </RetroPanel>

        {/* TYPOGRAPHY */}
        <RetroPanel ix="02" title="TYPOGRAPHY · 8×8 GRID + READABLE TERMINAL" tone="dark">
          <div className="row" style={{ padding: 14, gap: 18 }}>
            <div className="col grow gap-10">
              <div className="f-pix t-10 uc" style={{ color: 'var(--ink-dim)' }}>PRESS START 2P · UI / LABELS / NUMBERS</div>
              <div className="col gap-8">
                <div className="row ac gap-12"><span className="f-pix t-32" style={{ color: 'var(--ink)' }}>62.3%</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>32PX · TITLE ODDS</span></div>
                <div className="row ac gap-12"><span className="f-pix t-20" style={{ color: 'var(--ink)' }}>SERIES STATUS</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>20PX · H1</span></div>
                <div className="row ac gap-12"><span className="f-pix t-16" style={{ color: 'var(--ink)' }}>NEXT GAME</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>16PX · H2</span></div>
                <div className="row ac gap-12"><span className="f-pix t-12" style={{ color: 'var(--ink)' }}>MODEL ESTIMATE</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>12PX · SECTION HEAD</span></div>
                <div className="row ac gap-12"><span className="f-pix t-10" style={{ color: 'var(--ink)' }}>BRACKET COVERAGE</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>10PX · LABEL</span></div>
                <div className="row ac gap-12"><span className="f-pix t-9" style={{ color: 'var(--ink-dim)' }}>MANUAL · STATIC · NOT BETTING ADVICE</span><span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>9PX · META</span></div>
              </div>
            </div>
            <div className="col" style={{ width: 380, gap: 10, borderLeft: '2px solid var(--gray-sep)', paddingLeft: 16 }}>
              <div className="f-pix t-10 uc" style={{ color: 'var(--ink-dim)' }}>VT323 · READABLE BODY</div>
              <div className="f-term t-24" style={{ color: 'var(--ink)' }}>Methodology · 24 px headline</div>
              <div className="f-term t-20" style={{ color: 'var(--ink)' }}>How the model works — and what it doesn't see. Use this face for sentences longer than five words.</div>
              <div className="f-term t-16" style={{ color: 'var(--ink-dim)' }}>16 px supporting text. Used in tables and inline manual-adjustment notes.</div>
              <div className="f-term t-14" style={{ color: 'var(--ink-mute)' }}>14 px footnote · timestamps · raw inputs.</div>
            </div>
          </div>
        </RetroPanel>

        {/* PANELS */}
        <RetroPanel ix="03" title="PANELS · 4 TONES + RULES" tone="dark">
          <div className="row" style={{ padding: 14, gap: 12, flexWrap: 'wrap' }}>
            {[
              { tone: "dark",  label: "DARK · DEFAULT" },
              { tone: "green", label: "GREEN · TURF" },
              { tone: "cyan",  label: "CYAN · STAT" },
              { tone: "red",   label: "RED · WARNING" },
            ].map(p => (
              <div key={p.tone} style={{ flex: 1, minWidth: 220 }}>
                <RetroPanel ix={p.tone.slice(0,2).toUpperCase()} title={p.label} tone={p.tone}>
                  <div className="col" style={{ padding: 12, gap: 6 }}>
                    <span className="f-pix t-10 uc">SAMPLE CONTENT</span>
                    <span className="f-term t-16" style={{ color: 'var(--ink-dim)' }}>Body line within a panel of this tone.</span>
                  </div>
                </RetroPanel>
              </div>
            ))}
          </div>
        </RetroPanel>

        {/* BORDERS & SPACING */}
        <div className="row gap-16 as">
          <RetroPanel ix="04" title="BORDER RULES" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 12 }}>
              <div className="row ac gap-12"><div className="bd-2" style={{ width: 72, height: 36, background: 'var(--panel)' }} /><span className="f-pix t-10 uc">2 PX · STANDARD</span></div>
              <div className="row ac gap-12"><div className="bd-hard" style={{ width: 72, height: 36, background: 'var(--panel)' }} /><span className="f-pix t-10 uc">4 PX · HARD HERO</span></div>
              <div className="row ac gap-12"><div className="bd-double" style={{ width: 72, height: 36, background: 'var(--panel)' }} /><span className="f-pix t-10 uc">2+2 · DOUBLE</span></div>
              <div className="row ac gap-12"><div className="bd-2-dim" style={{ width: 72, height: 36, background: 'var(--bg-2)' }} /><span className="f-pix t-10 uc">2 PX DIM · BRACKET</span></div>
              <div className="row ac gap-12"><div style={{ width: 72, height: 36, background: 'var(--yellow)', backgroundImage: 'repeating-linear-gradient(135deg, var(--bg) 0 6px, transparent 6px 12px)' }} /><span className="f-pix t-10 uc">DITHER TAPE</span></div>
            </div>
          </RetroPanel>

          <RetroPanel ix="05" title="SPACING SCALE · 2 PX BASE" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 10 }}>
              {[2,4,6,8,12,16,24,32].map(s => (
                <div key={s} className="row ac gap-12">
                  <div style={{ width: s, height: 18, background: 'var(--yellow)' }} />
                  <span className="f-pix t-10 uc">{s} PX</span>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>
                    {s === 2 ? 'INNER STROKE' : s === 4 ? 'TIGHT INLINE' : s === 6 ? 'INLINE GAP' :
                     s === 8 ? 'CELL PADDING' : s === 12 ? 'PANEL GAP' : s === 16 ? 'BLOCK GAP' :
                     s === 24 ? 'SECTION GAP' : 'SCREEN MARGIN'}
                  </span>
                </div>
              ))}
            </div>
          </RetroPanel>

          <RetroPanel ix="06" title="TABLE STYLES" tone="dark" style={{ flex: 1.4 }}>
            <table className="pp-table">
              <thead><tr><th>TEAM</th><th className="num">CF</th><th className="num">FIN</th><th className="num">CHAMP</th></tr></thead>
              <tbody>
                <tr><td><TeamBadge team="BOS" size="sm" /></td><td className="num"><span className="heat h6">61.2</span></td><td className="num"><span className="heat h5">43.4</span></td><td className="num"><span className="heat h5">24.6</span></td></tr>
                <tr><td><TeamBadge team="CLE" size="sm" /></td><td className="num"><span className="heat h6">58.1</span></td><td className="num"><span className="heat h5">39.8</span></td><td className="num"><span className="heat h5">21.8</span></td></tr>
                <tr className="elim"><td><TeamBadge team="MIA" size="sm" /></td><td className="num"><span className="heat h0">—</span></td><td className="num"><span className="heat h0">—</span></td><td className="num"><span className="heat h0">—</span></td></tr>
              </tbody>
            </table>
            <div className="f-pix t-9 uc" style={{ padding: 8, color: 'var(--ink-mute)' }}>HEAT SCALE: H0 (NULL) → H6 (PEAK). ONE DECIMAL MAX ON %.</div>
          </RetroPanel>
        </div>

        {/* BUTTONS + WARNING + NUMBERS */}
        <div className="row gap-16 as">
          <RetroPanel ix="07" title="BUTTONS · PIXEL DROP" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 10, alignItems: 'flex-start' }}>
              <PixelButton>PRIMARY · YELLOW</PixelButton>
              <PixelButton variant="cyan">SECONDARY · CYAN</PixelButton>
              <PixelButton variant="green">SUCCESS · GREEN</PixelButton>
              <PixelButton variant="red">DANGER · RED</PixelButton>
              <PixelButton variant="ghost">GHOST · ON DARK</PixelButton>
              <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>3 PX HARD SHADOW · TRANSLATE ON HOVER · NEVER ROUND</span>
            </div>
          </RetroPanel>

          <RetroPanel ix="08" title="WARNING STYLES" tone="dark" style={{ flex: 1.2 }}>
            <div className="col" style={{ padding: 0 }}>
              <WarningStrip kind="yellow">MANUAL DATA · INPUTS LAST EDITED 11:02 AM ET</WarningStrip>
              <WarningStrip kind="red">NOT BETTING ADVICE · MODEL ESTIMATES ONLY</WarningStrip>
              <div className="row" style={{ padding: 12, gap: 6 }}>
                <span className="pill good">LIVE</span>
                <span className="pill warn">MANUAL ADJ</span>
                <span className="pill bad">ELIMINATED</span>
                <span className="pill cyan">DOCS</span>
                <span className="pill">DEFAULT</span>
              </div>
              <div className="f-pix t-9 uc" style={{ padding: '0 12px 12px', color: 'var(--ink-mute)' }}>RED FOR DEALBREAKERS, YELLOW FOR "WATCH THIS", PILLS FOR INLINE STATE.</div>
            </div>
          </RetroPanel>

          <RetroPanel ix="09" title="PROBABILITY · NUMBER TREATMENT" tone="dark" style={{ flex: 1.2 }}>
            <div className="col" style={{ padding: 14, gap: 12 }}>
              <div className="row ac gap-12">
                <span className="prob-num xl">24.6<span className="pct">%</span></span>
                <div className="col">
                  <span className="f-pix t-10 uc" style={{ color: 'var(--ink)' }}>HERO · 44 PX</span>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>1 DECIMAL · YELLOW % SIGN</span>
                </div>
              </div>
              <div className="row ac gap-12">
                <span className="prob-num lg good">62.3<span className="pct">%</span></span>
                <span className="prob-num lg warn">38.8<span className="pct">%</span></span>
                <span className="prob-num lg bad">11.1<span className="pct">%</span></span>
              </div>
              <div className="col gap-4">
                <ProbBar p={0.78} />
                <ProbBar p={0.45} tone="warn" />
                <ProbBar p={0.18} tone="danger" />
                <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>20-CELL CHUNKED BAR · CYAN/YELLOW/RED BY MAGNITUDE</span>
              </div>
              <div className="row ac gap-12">
                <div className="col gap-4">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>DOTS · SERIES SCORE</span>
                  <div className="row ac gap-6"><DotSeries wins={2} color="w" /><span className="f-pix t-9" style={{ color: 'var(--ink-mute)' }}>BO7</span><DotSeries wins={1} color="w" /></div>
                </div>
                <div className="col gap-4">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SIGNAL · CONFIDENCE</span>
                  <div className="row gap-6"><SigBars level={1} /><SigBars level={2} /><SigBars level={3} /><SigBars level={4} /></div>
                </div>
                <div className="col gap-4">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>COVERAGE</span>
                  <div className="row gap-6"><Coverage done={1} live /><Coverage done={2} live /><Coverage done={1} elim /></div>
                </div>
              </div>
            </div>
          </RetroPanel>
        </div>

        {/* TEAM BADGES */}
        <RetroPanel ix="10" title="TEAM BADGES · ALL 16" tone="dark">
          <div className="row" style={{ padding: 14, gap: 10, flexWrap: 'wrap' }}>
            {["CLE","BOS","NYK","MIL","ORL","IND","PHI","MIA","OKC","DEN","MIN","HOU","LAL","MEM","DAL","PHX"].map(t => (
              <div key={t} className="col ac gap-4">
                <TeamBadge team={t} size="lg" />
                <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{window.PP.T[t].conf}{window.PP.T[t].seed}</span>
              </div>
            ))}
          </div>
          <div className="f-pix t-9 uc" style={{ padding: 12, color: 'var(--ink-mute)', borderTop: '1px solid var(--gray-sep)' }}>3-LETTER ABBREVIATION · TEAM PRIMARY / SECONDARY COLOR · BORDER = SECONDARY · NEVER ROUNDED</div>
        </RetroPanel>

        {/* COMPONENT INVENTORY */}
        <RetroPanel ix="11" title="COMPONENT INVENTORY" tone="dark">
          <div className="row" style={{ padding: 14, gap: 0, flexWrap: 'wrap' }}>
            {[
              "ScoreboardHeader","ModelStatusStrip","RetroPanel","SeriesCard","StatBlock",
              "ProbabilityTable","TeamStrengthTable","AssumptionsPanel","PixelButton",
              "BracketRegion","WarningStrip","MethodologySection","TeamBadge","ProbBar",
              "DotSeries","SigBars","Coverage","Pill","HeatCell",
            ].map((c, i) => (
              <div key={c} style={{ flex: '1 1 18%', minWidth: 200, padding: '10px 12px', borderRight: (i % 5 !== 4) ? '1px solid var(--gray-sep)' : 'none', borderBottom: '1px solid var(--gray-sep)' }}>
                <div className="row ac gap-6">
                  <span className="f-pix t-9 uc" style={{ color: 'var(--yellow)' }}>C·{String(i+1).padStart(2,'0')}</span>
                  <span className="f-pix t-10 uc" style={{ color: 'var(--ink)' }}>{c}</span>
                </div>
              </div>
            ))}
          </div>
        </RetroPanel>

      </div>
    </div>
  );
}

// ─── SeriesCard variants showcase ────────────────────────────
function SeriesCardShowcase() {
  return (
    <div className="pp-frame col" data-screen-label="Series Card Variants">
      <div className="col" style={{ background: 'var(--bg)', padding: '14px 20px', borderBottom: '4px solid var(--ink)' }}>
        <div className="row ac gap-12">
          <div className="sb-logo">548</div>
          <span className="f-pix t-14 uc">SERIES CARD · COMPONENT</span>
          <span className="grow" />
          <span className="pill">4 VARIANTS</span>
        </div>
        <span className="f-term t-16" style={{ color: 'var(--ink-dim)', marginTop: 6 }}>
          Tecmo-style scorestrip, 20-cell probability bars, manual-adjustment note, expected margin, confidence signal, day-over-day shift.
        </span>
      </div>

      <div className="row" style={{ padding: 20, gap: 16, flexWrap: 'wrap', background: 'var(--bg)' }}>
        {window.PP.semis.map((s) => (
          <div key={s.a + s.b} style={{ flex: '1 1 calc(50% - 8px)', minWidth: 460 }}>
            <SeriesCard s={s} />
          </div>
        ))}
      </div>

      <div className="col" style={{ padding: 20, gap: 12, borderTop: '2px solid var(--gray-sep)' }}>
        <span className="f-pix t-11 uc" style={{ color: 'var(--yellow)' }}>ANATOMY</span>
        <div className="row gap-16" style={{ flexWrap: 'wrap' }}>
          {[
            "Conference + round + game-number tag · top-left",
            "LIVE pulse · top-right (no countdown for non-live)",
            "Three-column scorestrip · home/away seed",
            "Next-game cell · date · time · venue · +2.5 HCA",
            "Two-row probability stack · next + series",
            "Margin / confidence / 7-day shift triplet",
            "Manual adjustment note · always present, always tagged",
          ].map((l, i) => (
            <div key={i} className="row gap-6 ac" style={{ flex: '1 1 320px' }}>
              <span className="f-pix t-9" style={{ color: 'var(--yellow)' }}>{String(i+1).padStart(2,'0')}</span>
              <span className="f-term t-16" style={{ color: 'var(--ink-dim)' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Probability Table standalone ────────────────────────────
function ProbabilityTablePage() {
  return (
    <div className="pp-frame col" data-screen-label="Probability Table">
      <div className="col" style={{ background: 'var(--bg)', padding: '14px 20px', borderBottom: '4px solid var(--ink)' }}>
        <div className="row ac gap-12">
          <div className="sb-logo">548</div>
          <span className="f-pix t-14 uc">PROBABILITY TABLE · MODEL ESTIMATE</span>
          <span className="grow" />
          <span className="pill warn">MANUAL DATA</span>
          <span className="pill">v0.3.1</span>
        </div>
      </div>

      <div className="col" style={{ padding: 20, gap: 16 }}>
        <RetroPanel ix="P" title="ALL 16 · CONF FINALS · FINALS · CHAMP" tone="dark"
          right={<span className="row ac gap-8" style={{ display: 'inline-flex' }}>
            <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>SORT</span>
            <span className="pill warn">CHAMP%</span>
            <span className="pill">CF%</span>
            <span className="pill">SEED</span>
          </span>}>
          <ProbabilityTable />
        </RetroPanel>

        <div className="row gap-12 as">
          <RetroPanel ix="L" title="HOW TO READ THIS" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 8 }}>
              <div className="f-term t-20" style={{ color: 'var(--ink)' }}>Each cell is the share of 20,000 Monte Carlo bracket simulations in which that team reached that round (or won the title).</div>
              <div className="f-term t-16" style={{ color: 'var(--ink-dim)' }}>CONF F = made conference finals · FINALS = made NBA finals · CHAMP = won title. The CHAMP column always sums to 100% across all 16 teams (eliminated teams = 0).</div>
              <div className="row gap-6 ac"><span className="heat h6">30+</span><span className="heat h5">20+</span><span className="heat h4">10+</span><span className="heat h3">5+</span><span className="heat h2">&gt;0</span><span className="heat h0">—</span></div>
              <span className="f-pix t-9 uc" style={{ color: 'var(--ink-mute)' }}>HEAT SCALE</span>
            </div>
          </RetroPanel>
          <RetroPanel ix="C" title="COVERAGE STATUS LEGEND" tone="dark" style={{ flex: 1 }}>
            <div className="col" style={{ padding: 14, gap: 10 }}>
              <div className="row ac gap-8"><Coverage done={1} live /><span className="f-term t-16">Round done · next round LIVE</span></div>
              <div className="row ac gap-8"><Coverage done={2} live /><span className="f-term t-16">Two rounds done · CF live</span></div>
              <div className="row ac gap-8"><Coverage done={4} /><span className="f-term t-16">Won championship</span></div>
              <div className="row ac gap-8"><Coverage done={1} elim /><span className="f-term t-16">Eliminated in R2</span></div>
              <div className="row ac gap-8"><Coverage done={0} elim /><span className="f-term t-16">Eliminated in R1</span></div>
            </div>
          </RetroPanel>
        </div>
      </div>
    </div>
  );
}

// ─── Assumptions + Methodology standalone ────────────────────
function MethodologyPage() {
  return (
    <div className="pp-frame col" data-screen-label="Methodology + Assumptions">
      <ScoreboardHeader subtitle="METHODOLOGY · ASSUMPTIONS · LIMITATIONS · v0.3.1" />
      <WarningStrip kind="red">EVERY NUMBER ON THE DASHBOARD CARRIES A MANUAL ASSUMPTION. THIS PAGE LISTS THEM.</WarningStrip>

      <div className="row" style={{ padding: 22, gap: 18, alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: 1.4, gap: 18 }}>
          <MethodologySection />
        </div>
        <div className="col" style={{ flex: 1, gap: 16, position: 'sticky', top: 14 }}>
          <AssumptionsPanel />

          <RetroPanel ix="R" title="ROADMAP · WHAT v0.4 + v0.5 ADD" tone="dark">
            <div className="col" style={{ padding: 14, gap: 10 }}>
              {[
                { v: "v0.4", k: "LIVE INJURY FEED", t: "Q3" },
                { v: "v0.4", k: "BAYESIAN IN-SERIES UPDATE", t: "Q3" },
                { v: "v0.4", k: "PLAYOFF-SPECIFIC CALIBRATION", t: "Q3" },
                { v: "v0.5", k: "ROTATION / MINUTES FEED", t: "Q4" },
                { v: "v0.5", k: "TRAVEL + REST MODEL", t: "Q4" },
                { v: "v0.5", k: "REFEREE TENDENCY ADJUSTMENT", t: "Q4" },
              ].map((r, i) => (
                <div key={i} className="row ac jb" style={{ borderBottom: '1px solid var(--gray-sep)', paddingBottom: 6 }}>
                  <span className="pill cyan">{r.v}</span>
                  <span className="f-pix t-9 uc grow" style={{ marginLeft: 10 }}>{r.k}</span>
                  <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{r.t}</span>
                </div>
              ))}
            </div>
          </RetroPanel>

          <RetroPanel ix="W" title="WHAT WE'D RATHER YOU TAKE AWAY" tone="dark">
            <div className="col" style={{ padding: 14, gap: 8 }}>
              <div className="f-term t-20" style={{ color: 'var(--ink)' }}>The probabilities are a structured summary of explicit assumptions. They are not a prediction. They will be wrong.</div>
              <div className="f-term t-16" style={{ color: 'var(--ink-dim)' }}>The point of this dashboard is to make the assumptions visible enough to argue with, not to convince you the model is right.</div>
            </div>
          </RetroPanel>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { StyleGuide, SeriesCardShowcase, ProbabilityTablePage, MethodologyPage });
