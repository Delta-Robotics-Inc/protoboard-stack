# Eval baseline 2026-10-03

Host **claude-code** (2.1.288 (Claude Code)), 3 trial(s) per case, rubric judge claude-code. Protoboard 0.1.0, Node v24.14.1.

**44/45 trials passed (98%), mean score 1.00.** 15 case(s) ran, 0 skipped, 0 error(s); cost $34.16.

| Case | Status | Pass | Score | Time | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `@protoboard/ext-docs/build-datasheet` | ran | 67% | 0.96 | 66.2 s | 20.7 | $1.15 |
| `@protoboard/ext-drone/gps-moved-to-uart3` | ran | 100% | 1.00 | 35.6 s | 11.7 | $0.87 |
| `@protoboard/ext-enclosure-cad/fit-grown-board` | ran | 100% | 1.00 | 58.3 s | 8.7 | $0.75 |
| `@protoboard/ext-esp-idf/wake-on-fuel-gauge` | ran | 100% | 1.00 | 63.9 s | 14.7 | $1.12 |
| `@protoboard/ext-frame-cad/regenerate-after-vtx-move` | ran | 100% | 1.00 | 52.6 s | 10.7 | $0.94 |
| `@protoboard/ext-hardware/compose-probe-cable` | ran | 100% | 1.00 | 113.3 s | 17.7 | $1.88 |
| `@protoboard/ext-hardware/e2e-desk-rover` | ran | 100% | 0.99 | 514.7 s | 89 | $13.18 |
| `@protoboard/ext-hardware/fix-gnss-uart-swap` | ran | 100% | 1.00 | 22.3 s | 6 | $0.66 |
| `@protoboard/ext-harness-cad/reroute-after-vtx-move` | ran | 100% | 1.00 | 350.2 s | 7.7 | $0.67 |
| `@protoboard/ext-parts/author-ldo-regulator` | ran | 100% | 0.98 | 194.8 s | 40.3 | $5.25 |
| `@protoboard/ext-release/release-after-hand-edit` | ran | 100% | 1.00 | 301.2 s | 32 | $2.31 |
| `@protoboard/ext-sourcing/record-ldo-offers` | ran | 100% | 1.00 | 48.3 s | 19 | $1.03 |
| `@protoboard/ext-tscircuit/catch-swapped-nets` | ran | 100% | 1.00 | 167 s | 15.7 | $1.41 |
| `@protoboard/ext-tscircuit/generate-imu-board` | ran | 100% | 1.00 | 109.1 s | 15 | $1.29 |
| `@protoboard/ext-zephyr/haptic-driver-mode` | ran | 100% | 1.00 | 99.8 s | 20.7 | $1.65 |

- `@protoboard/ext-docs/build-datasheet`:
  - trial 1 reads-well: claude-code: 0.60 — Three of five criteria are met on the material shown; the values file is truncated mid-entry, so the judgement covers only the visible part.  **Met** - **Criterion 1 (status and derivation):** Every visible entry has a status (source, derived, model or assumpt
