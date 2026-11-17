[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/M3264/token-launch-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/M3264/token-launch-radar/reward.svg)](https://make.fun/c/token-radar-01)

# Token Launch Radar

Ranks every pre-token protocol in the sealed snapshot by an implied value derived from its own TVL, 7-day growth, age with no token, chain spread and deposit velocity — each row carrying a concrete 7-step farm plan with costs and holding times.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
node gate-check.cjs --input /path/to/snapshot.json --out out
```

`main.ts` (Node 22, stdlib only, no network) scores the 40 watchlist protocols plus every rankable pre-token protocol below the $50M floor, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` via `vendor/makefun-board.ts`.

---
Built for the [token-radar-01 bounty](https://make.fun/c/token-radar-01) — referral: https://make.fun/r/mb0cqaeg
