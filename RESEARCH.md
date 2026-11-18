# Radar-5 — research note

## The question

v3 ("radar-4") priced pre-token protocols off a comps curve that
finally fit: LOO R² 0.31, time-split R² 0.35. Its own Limitations
section flagged the one number it was unsure about — the slope,
0.63, steeper than the 0.47–0.56 the top of the leaderboard reports.
The question for this build was narrow: does pulling the slope
toward 0.5 make the curve predict held-out tokens better, or does
it just make the slope look more like the winners'? And a second,
smaller question: v3's research note wrote "101 comps" on the row
whose metrics were computed on 89 — which count is right?

## The snapshot

758 protocols, sealed. 342 are pre-token, 416 already trade. 128
traded protocols have both a market cap and a TVL above zero, so
128 could in principle anchor a curve. The watchlist is 40
protocols at $50,000,000 TVL or more.

## The comps count, corrected

101 traded protocols pass the ratio band [0.01, 10]. Twelve of
those are exchanges or bridges, which the house rule excludes from
the comps, leaving **89 comps** for the final curve. v3's note
wrote "101 comps" on the sanity-band row of its candidate table
while the metrics on that row (LOO 0.309, time-split 0.349) were
already computed on the 89 final comps — the count was wrong, the
numbers were right. Every metric in this note is computed on the
89 final comps, and the table below says so.

## What the curve was tested against

Every candidate below was scored the same way: leave-one-out on
the comps (each traded token predicted from a curve fitted without
it), plus a time split (tokens listed before 2024 predict tokens
listed since, n = 37), plus a flat-multiple baseline (one median
mcap/TVL for everything). In-sample R² was never the selector — it
only ever flattered the wrong model. The shrink rows are measured
in this build's harness; the category and Huber rows are from the
18 Nov deep analysis, same snapshot, same protocol.

| candidate | comps | LOO R² | LOO median miss | within 3× | time-split median | time-split R² |
|---|---|---|---|---|---|---|
| v3 baseline, plain OLS slope 0.6268 | 89 | 0.309 | ×2.75 | 52% | ×2.51 | 0.349 |
| slope shrunk w=0.75 toward 0.5 | 89 | 0.311 | ×2.70 | 53% | ×2.43 | 0.347 |
| **slope shrunk w=0.5 toward 0.5** | **89** | **0.310** | **×2.66** | **56%** | **×2.31** | **0.343** |
| slope shrunk w=0.25 toward 0.5 | 89 | 0.308 | ×2.71 | 56% | ×2.21 | 0.339 |
| slope fixed at 0.5 (w=0) | 89 | 0.304 | ×2.75 | 57% | ×2.09 | 0.332 |
| + category effects, shrink k=2 | 89 | 0.273 | ×3.02 | — | ×2.55 | 0.269 |
| + category effects, shrink k=4 | 89 | 0.288 | ×2.98 | — | ×2.55 | 0.286 |
| + category effects, shrink k=8 | 89 | 0.299 | ×2.94 | — | ×2.55 | 0.305 |
| + category effects, shrink k=16 | 89 | 0.305 | ×2.89 | — | ×2.55 | 0.323 |
| Huber robust fit, same 89 | 89 | 0.305 | — | — | — | 0.347 |
| Huber robust fit, no ratio screen | 101 | 0.108 | — | — | ×2.78 | 0.035 |
| band [0.02, 5], same test set | — | — | — | — | — | 0.340 |
| band [0.005, 20], same test set | — | — | — | — | — | 0.349 |
| flat multiple (baseline) | — | — | ×4.73 | — | — | — |

## The finding: the shrink is the only lever that moves the median

Shrinkage improves the median miss on both out-of-sample tests
(leave-one-out ×2.75 → ×2.66, time-split ×2.51 → ×2.31 at w=0.5)
while R² slips by 0.006 on each — inside noise. The slope gets
flatter, so the worst errors shrink, but no extra variance is
explained. Pushing the shrink further (w=0.25, w=0) keeps improving
the time-split median (×2.21, ×2.09) but costs more R² (0.339,
0.332) and the leave-one-out median turns back up, so w=0.5 is the
balance point, not the extreme. The effect is small and it is the
only real one on the table: category effects fail both metrics at
every shrinkage level, the Huber fit is a tie on 89 comps and a
catastrophe without the screen, and no other ratio band wins on the
same test set. The screen stays the model — without it, twelve
extreme-ratio tokens (rain at ×400.20, bitway-earn ×36.17,
flokifi-locker ×18.98, aave-v2 ×18.96, anvil ×12.16, and seven at
×0.01–×0.00) bend the curve out of shape.

The shrink is applied at every fit — the full fit, each
leave-one-out fold, the time-split fit and every bootstrap refit —
so the board, its bands and its odds all come from the same
estimator. The dashboard refits the curve the same way and checks
every row against the board; the badge at the top of the board
reports the match count.

## The final model (radar-5)

log10(mcap) = 2.6436 + 0.5634 × log10(TVL), fitted on 89 traded
protocols (mcap > 0, TVL > 0, not a CEX or bridge, mcap/TVL in
[0.01, 10]). The plain least-squares fit underneath is 2.1649 +
0.6268 × log10(TVL); the slope is pulled halfway toward the 0.5
prior and the intercept is refit through the data's centre.
Validation: LOO median miss ×2.66 (56% within 3×, LOO R² 0.310,
rank correlation 0.52), time-split median miss ×2.31 (n = 37,
R² 0.343), flat multiple ×4.73. Against v3: LOO R² 0.310 vs 0.309,
LOO median ×2.66 vs ×2.75, time-split R² 0.343 vs 0.349,
time-split median ×2.31 vs ×2.51.

Three priors, stated rather than fitted — the data rejected fitting
them, so they are fixed and disclosed:

- Growth: 1 + 0.5 × 7-day TVL change, change clamped to −40%/+60%.
- Maturity: 1 − 0.4·e^(−age/240), so a protocol is worth 60% of the
  curve on listing day and ~100% after two years; unknown age counts
  as 365 days.
- Breadth: +3% per extra chain, at most four extra.

Uncertainty: 200 bootstrap refits (seeded, seed 20261114) give each
row a P25–P75 band, a rank range (P10–P90), and break-even odds — the
share of refits in which the farm pays back. The top row's band is
$86M–$109M and its rank range is #1–#1; the uncertainty grows down
the board, and the dashboard shows it.

## The board

197 rows: the 40 watchlist protocols plus 157 early ones, ranked by
implied value, ranks exactly 1..197. The board excludes what the top
entries exclude: traded tokens (128 set aside), and 145 pre-token
protocols that are someone's product — a CEX, a versioned name, a
wrapped or staked product, an exchange's own name, a bridge or a
liquid-staking product. Each set-aside carries its reason in the
dossier. The top row is Steakhouse Financial at $97,307,225; the
last is Monarq at $1,681,008. The flatter slope moves value toward
smaller protocols: Steakhouse falls from v3's $128,219,646 and
Monarq rises from $1,486,944.

## Farm economics, netted to the dollar

Every row carries an 8-step plan for a $1,000 deposit. The slice is
what $1,000 gets if 10% of the launch goes to depositors pro rata:
$1,000 × 0.10 × implied value / TVL. Gas is priced for the chain the
farm actually uses: $0.50 to set up plus $0.15 a week on a rollup,
$5 plus $2 a week on Ethereum or Bitcoin mainnet — and a protocol
that lives on an expensive chain alone is where the fees eat the
drop. The hold is 60 days for a seasoned protocol, 90 for one under a
year old, 120 for one under 90 days. The forgone yield is a 4% T-bill
on the $1,000 over the hold.

Verdicts: FARM if the net clears the T-bill, THIN if it clears the
fees only, SKIP if it does not clear the fees. The board comes out
FARM 151 / THIN 29 / SKIP 17 (v3: 152 / 25 / 20). The giants are
THIN — Steakhouse's slice does not cover a 60-day T-bill — and the
SKIP rows are almost all Ethereum- or Bitcoin-only protocols whose
mainnet gas ($23–$41) is larger than their slice. Lightning Network
is SKIP for exactly that reason. The net per hands-on hour (setup,
weekly actions, claim) is on every row.

## v3 vs v4, on the metrics set before building

| metric | v3 (radar-4) | v4 (radar-5) |
|---|---|---|
| slope (OLS → shrunk) | 0.6268 | 0.6268 → 0.5634 |
| LOO R² | 0.309 | 0.310 |
| LOO median miss | ×2.75 | ×2.66 |
| time-split R² | 0.349 | 0.343 |
| time-split median miss | ×2.51 | ×2.31 |
| protocols priced | 197 | 197 |
| farm plans netted to the dollar (verdict + net + odds) | 100% | 100% |
| farm verdicts FARM / THIN / SKIP | 152 / 25 / 20 | 151 / 29 / 17 |

v4 is a small, measured change, not a rebuild: one slope, one
corrected count, everything else kept. The median — the number the
dashboard shows a reader — is better on both out-of-sample tests;
R² is a touch lower on the time split. That trade is stated here
rather than hidden.

## Limitations

The curve is pooled: one slope for every category, because category
effects failed validation on both tests — a category that truly
prices differently will be mispriced. The slope (0.56) now sits
inside the 0.47–0.56 the top entries report, but the shrink is a
prior, not a discovery: the data cannot tell 0.56 from 0.63 on R²,
only on the median. The 10% farmer share is a guess, not a
measurement, and the gas tiers are estimates, not quotes. Implied
values are expectations under the curve, not predictions of a launch
price.

## Reproducing

`MAKEFUN_OUTPUT_DIR=out node main.ts --input
../token-radar-01-kit/input/snapshot.json` rebuilds the board,
the dashboard, the screenshots and the dossier from the sealed
snapshot. The dashboard re-runs the model in the browser and checks
every row against board.json; the badge at the top of the board
reports the match count. `node
../token-radar-01-kit/cli/makefun.mjs check --worktree` runs the
kit's local grade.
