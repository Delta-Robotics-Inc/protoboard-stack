# Eval run EV6 ablation without the skills, 2026-10-03

Host **claude-code** (2.1.288 (Claude Code)), 3 trial(s) per case, rubric judge claude-code, **without the stack's skills** (ablation), 3 jobs. Protoboard 0.1.0, Node v24.14.1.

**8/9 trials passed (89%), mean score 0.99.** 3 case(s) ran, 0 skipped, 0 error(s); cost $6.71.

| Case | Status | Pass | Score | Time | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `@protoboard/ext-hardware/fix-gnss-uart-swap` | ran | 100% | 1.00 | 26.9 s | 7 | $0.53 |
| `@protoboard/ext-parts/author-ldo-regulator` | ran | 67% | 0.97 | 209.8 s | 45 | $4.87 |
| `@protoboard/ext-sourcing/record-ldo-offers` | ran | 100% | 1.00 | 67.7 s | 24.7 | $1.32 |

- `@protoboard/ext-parts/author-ldo-regulator`:
  - trial 3 modelling: claude-code: 0.50 — Two of five criteria are fully met and three are partially met, each counted as half; 1 + 1 + 3 × 0.5 = 2.5 of 5. **Met** - **Criterion 2 (pins):** Five interfaces, one per pin, with the right designators: 1 VIN power_in 2.5-6.0 V, 2 GND ground, 3 EN input, 4 NC nc, 5 VOUT power output at 3.3 V nominal. - **Criterion 3 (ratings):** Output current 300 mA, dropout (180 typ / 260 max mV), quiescent current (45 typ / 70 max µA), operating conditions (§5) and absolute maximums (§4) are all recorded with their datasheet sections (§1, §6). **Unmet or only partially met** - **Criterion 1 (header):** The header cites the datasheet (Rev. 3, URL), the CAD sources and the terms file, but it states no modelling notes. The modelling decisions (3.2 mm width taken from the STEP, EN upper bound, data gaps) appear only in the body. - **Criterion 4 (no invention, assumptions as traits):** Gaps are handled honestly with `data_gap` traits and nulls. However, the one assumed value, the 3.2 mm width over the leads measured from the STEP, is recorded as a free-text `assumption` field on the package object, not as an assumption trait. The EN 6.0 V upper bound is likewise explained in a `usage_note`, not an assumption trait. - **Criterion 5 (CAD body, sha256, licence, terms):** The manufacturer GLB is bound as `role: "body"` and the STEP as source, both marked unmodified. The artifacts in the definition carry no sha256 and no licence. The final answer says these are in `sources.json` and `terms.json`, but neither evidence file is shown, so that cannot be confirmed from the material.
