// ============================================================
// 548 / Playoff Pulse — primitive pixel-broadcast components
// All components are exported to window so other JSX files can use them.
// ============================================================

const { useState, useEffect, useMemo } = React;

// ─── ScoreboardHeader ─────────────────────────────────────────
function ScoreboardHeader({ subtitle = "2026 NBA PLAYOFFS · CONFERENCE SEMIFINALS · DAY 14", time = "12:48 PM ET", version = "v0.3.1" }) {
  return (
    <div className="scoreboard pp-scan-lite">
      <div className="scoreboard-strip">
        <div className="sb-cell" style={{ paddingLeft: 18 }}>
          <div className="sb-logo">548</div>
          <div className="col" style={{ gap: 3 }}>
            <div className="t-9 f-pix uc" style={{ color: 'var(--ink)' }}>PLAYOFF PULSE</div>
            <div className="t-9 f-pix uc" style={{ color: 'var(--ink-dim)' }}>FORECASTING ENGINE</div>
          </div>
        </div>
        <div className="sb-cell grow">
          <div className="sb-tag uc" style={{ fontSize: 'var(--t-11)' }}>{subtitle}</div>
        </div>
        <div className="sb-cell">
          <div className="sb-tag uc"><span className="sb-blink" />MODEL <b>{version}</b></div>
        </div>
        <div className="sb-cell">
          <div className="sb-tag uc">{time}</div>
        </div>
        <div className="sb-cell" style={{ paddingRight: 18 }}>
          <div className="kbd">P</div>
          <div className="sb-tag uc">PAUSE REFRESH</div>
        </div>
      </div>
    </div>
  );
}

// ─── Status strip below header ────────────────────────────────
function ModelStatusStrip({ items }) {
  const defaultItems = items || [
    { k: "DATA",   v: "MANUAL · STATIC", kind: "warn" },
    { k: "SIMS",   v: "N=20,000",        kind: "" },
    { k: "ELO",    v: "REG-SEASON",      kind: "" },
    { k: "HCA",    v: "+2.5 PTS",        kind: "" },
    { k: "LAST",   v: "12:48 PM ET",     kind: "" },
    { k: "REFRESH",v: "MANUAL",          kind: "warn" },
  ];
  return (
    <div className="row" style={{ background: 'var(--bg-2)', borderBottom: '2px solid var(--gray-sep)' }}>
      {defaultItems.map((it, i) => (
        <div key={i} className="row ac gap-6" style={{ padding: '8px 14px', borderRight: '2px solid var(--gray-sep)', flex: 1 }}>
          <span className="f-pix t-9 uc" style={{ color: 'var(--ink-dim)' }}>{it.k}</span>
          <span className={`f-pix t-9 uc`} style={{ color: it.kind === 'warn' ? 'var(--yellow)' : 'var(--ink)' }}>{it.v}</span>
        </div>
      ))}
    </div>
  );
}

// ─── RetroPanel ───────────────────────────────────────────────
function RetroPanel({ ix, title, right, tone = "dark", children, scan = false, style }) {
  return (
    <div className={`col bd-2 ${scan ? 'pp-scan-lite' : ''}`} style={{ background: 'var(--panel)', position: 'relative', ...style }}>
      <div className={`sec-head ${tone === 'dark' ? 'dark' : tone === 'cyan' ? 'cyan' : tone === 'green' ? 'green' : tone === 'red' ? 'red' : ''} row ac jb`}>
        <div className="row ac gap-8">
          {ix && <span className="ix">{ix}</span>}
          <span>{title}</span>
        </div>
        {right && <div className="row ac gap-8">{right}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── TeamBadge ─────────────────────────────────────────────────
function TeamBadge({ team, size = "md" }) {
  const T = window.PP.T[team];
  const cls = size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : size === 'sm' ? 'sm' : '';
  return (
    <span className={`team-badge ${cls}`} style={{ background: T.color, color: T.color2, borderColor: T.color2 }}>
      {T.abbr}
    </span>
  );
}

// ─── ProbBar ──────────────────────────────────────────────────
// Full bar, thick ink border, yellow fill. Unified across the system.
function ProbBar({ p, size = "md" }) {
  const pct = Math.max(0, Math.min(1, p)) * 100;
  const cl = size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : size === 'xs' ? 'xs' : '';
  const showEdge = pct > 2 && pct < 98;
  return (
    <div className={`probfill ${cl}`}>
      <i style={{ width: `${pct}%` }} className={showEdge ? 'has-edge' : ''} />
    </div>
  );
}

// ─── ProbNumber ───────────────────────────────────────────────
function ProbNum({ value, size = "md", tone = "" }) {
  // value as 0..1 -> "62.3%"
  const pct = (value * 100);
  const txt = pct.toFixed(1);
  const cls = size === 'xl' ? 'xl' : size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : '';
  return (
    <span className={`prob-num ${cls} ${tone}`}>
      {txt}<span className="pct">%</span>
    </span>
  );
}

// ─── PixelButton ──────────────────────────────────────────────
function PixelButton({ children, variant = "yellow", ...rest }) {
  return <button className={`pp-btn ${variant === 'ghost' ? 'ghost' : variant === 'red' ? 'red' : variant === 'green' ? 'green' : variant === 'cyan' ? 'cyan' : ''}`} {...rest}>{children}</button>;
}

// ─── StatBlock ────────────────────────────────────────────────
function StatBlock({ label, value, sub, valStyle }) {
  return (
    <div className="stat-block">
      <div className="lbl uc">{label}</div>
      <div className="val" style={valStyle}>{value}</div>
      {sub && <div className="sub uc">{sub}</div>}
    </div>
  );
}

// ─── DotSeries — series score dots like Tecmo ─────────────────
function DotSeries({ wins, color = "w", total = 4 }) {
  return (
    <span className="row gap-4">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`dotmark ${i < wins ? color : ''}`} />
      ))}
    </span>
  );
}

// ─── SignalBars ───────────────────────────────────────────────
function SigBars({ level = 3 }) {
  return (
    <span className="sigbar">
      {[1,2,3,4].map(i => <span key={i} className={i <= level ? 'on' : ''} />)}
    </span>
  );
}

// ─── Coverage strip ──────────────────────────────────────────
function Coverage({ done = 0, live = false, elim = false }) {
  // done = 0..4 (rounds completed). live = currently active in next round. elim = all subsequent gray.
  const labels = ["R1","R2","CF","FN"];
  return (
    <span className="cov">
      {labels.map((l, i) => {
        let cls = 'poss';
        if (elim) cls = i < done ? 'done' : 'elim';
        else if (i < done) cls = 'done';
        else if (i === done && live) cls = 'live';
        return <span key={i} className={cls}>{l}</span>;
      })}
    </span>
  );
}

// ─── WarningStrip ────────────────────────────────────────────
function WarningStrip({ children, kind = "yellow" }) {
  return (
    <div className={`warn-strip ${kind === 'red' ? 'red' : ''}`}>
      <span>{children}</span>
    </div>
  );
}

Object.assign(window, {
  ScoreboardHeader, ModelStatusStrip, RetroPanel, TeamBadge, ProbBar, ProbNum,
  PixelButton, StatBlock, DotSeries, SigBars, Coverage, WarningStrip,
});
