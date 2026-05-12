// ============================================================
// 548 / Playoff Pulse — DesignCanvas (top-level artboard layout)
// ============================================================

const { useEffect: _useEffect } = React;

function App() {
  return (
    <DesignCanvas>
      <DCSection id="dashboards" title="Dashboards" subtitle="Desktop primary · mobile compact">
        <DCArtboard id="desktop" label="Desktop · 1440 × 2680" width={1440} height={2680}>
          <DesktopDashboard />
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile · 390 × 2200" width={390} height={2200}>
          <MobileDashboard />
        </DCArtboard>
      </DCSection>

      <DCSection id="components" title="Components" subtitle="Series card · probability table">
        <DCArtboard id="series-card" label="Series Card · variants" width={1100} height={1480}>
          <SeriesCardShowcase />
        </DCArtboard>
        <DCArtboard id="prob-table" label="Probability Table" width={1100} height={1280}>
          <ProbabilityTablePage />
        </DCArtboard>
      </DCSection>

      <DCSection id="reference" title="Reference" subtitle="Assumptions + methodology · style guide">
        <DCArtboard id="methodology" label="Methodology + Assumptions" width={1440} height={1900}>
          <MethodologyPage />
        </DCArtboard>
        <DCArtboard id="styleguide" label="Style Guide · Design Tokens" width={1440} height={2360}>
          <StyleGuide />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
