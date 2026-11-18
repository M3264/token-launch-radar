# Token Launch Radar

An offline Node 22 entry for make.fun's `token-radar-01`. It reads the supplied snapshot, ranks pre-token research candidates, renders a searchable dashboard and builds the dossier with the unmodified kit vendor.

## Run and verify

```sh
INPUT=/path/to/snapshot.json
node main.ts --input "$INPUT" --output out
npm test
node gate-check.cjs --input "$INPUT" --out out
node main.ts --input "$INPUT" --output out-repeat
```

Node 22 executes the TypeScript directly; no package installation, external API, network access or separate compilation is required. Generate `out` before running tests: the gate-mutation test deliberately modifies a temporary copy of the generated dashboard data. `nested.ts` and `lib/experimental-value.ts` support validation tests and are not production scoring dependencies.

Open `out/dashboard/index.html` to inspect the local dashboard. The entry writes `board.json`, `data.js`, `dossier.json`, validation reports and an unranked research universe. It copies the dashboard and three committed screenshots into the output directory. Generated outputs and development logs are not committed.

## Model and uncertainty

The point model is Huber regression of log market-cap/TVL on standardized log TVL, bounded growth, log tracking age and chain count. Its multiple is transparently clipped to [0.05, 2]. Training uses positive, finite live-token market caps and TVL, excluding CEX records. Deterministic held-out folds use training-only scaling; exact repeated CoinGecko IDs stay together. Nested validation and outer-target mutation tests guard against target leakage.

The supplied snapshot produces 175 ranked rows: all 40 mandatory watchlist entries and 135 additional early candidates. Another 51 optional rows are held for uncertain wrapper or sibling identity, with explicit reasons rather than claims of proven common ownership. Null token fields do not establish token absence. Conservative rules cannot identify every possible wrapper or sibling.

Split-conformal reference ranges describe live-token exchangeability, not launch odds or expected airdrop payout. The snapshot's 119 eligible live protocols yield exploratory held-out median absolute log error 1.2608 (factor 3.5284), not a temporal forecast or investment guarantee. Farm plans are conditional research pilots with illustrative capital, unquoted gas and no invented eligibility claims.

## Reproducible dossier

Generation copies the exact executable `lib/value.ts`, `lib/uncertainty.ts` and `lib/identity.ts` into the dossier's capped dashboard source alongside a freshly calculated validation summary. The gate independently recomputes every ranked value from emitted coefficients and checks full board/data agreement, watchlist coverage, output caps, screenshot dimensions and untruncated method visibility. The mutation test verifies that tampering with coefficients is rejected.

The current snapshot passes all 13 Node tests and the output gate. Two generation runs were verified byte-identical across all 16 output files. These are local checks, not a server judge score or a claim of submission acceptance.
