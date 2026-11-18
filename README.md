# token-radar-v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kavivenn-blip/token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kavivenn-blip/token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar radar-5: a pre-token launch radar that prices every protocol with no token off the tokens that already trade. The curve is a log-log fit of market cap on TVL over the 89 traded tokens whose market plainly prices their TVL — with the slope shrunk halfway toward 0.5 and the intercept refit — proved leave-one-out (median miss ×2.66) and on a time split (×2.31), and every row carries a P25–P75 band from 200 bootstrap refits plus a farm verdict — FARM, THIN or SKIP — netted to the dollar against gas and the forgone 4% T-bill yield. 197 protocols ranked, 40/40 on the watchlist. The method, the candidate comparison and the limits are in RESEARCH.md.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Node 22, standard library only, no network. The program reads the sealed snapshot, fits and proves the curve, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and the dossier to `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hp1z0q8b&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
