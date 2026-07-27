# Frozen 2003–2025 evaluation record

- Frozen from commit: `3d10ba7530c18fbe6a86e4db1bf136f9f0f0bf45`
- Freeze date: 2026-07-27
- Exact evaluation scope: NBA playoff seasons 2003–2025

The JSON files in this directory are the complete generated evaluation
artifacts that existed before any 2026 data was ingested. They are the
pre-2026 record and must never be regenerated or modified.

`SHA256SUMS` records one SHA-256 checksum for every frozen JSON artifact.
Run `corepack pnpm backtest:verify-frozen` to verify both the checksums and
the exact artifact inventory.
