// Token Radar radar-5: one snapshot in, one ranked board out.
//
// radar-5 prices pre-token protocols off the tokens that already trade,
// and it proves the price before it uses it. The curve is a log-log fit
// of market cap on TVL over the snapshot's own traded tokens — but only
// the ones that can anchor a TVL curve. A traded token counts as a comp
// when its market cap sits within a hundredfold band of its TVL
// (0.01x to 10x). Outside that band the market is plainly pricing
// something else — a token at 400x its TVL, or a protocol whose token
// trades at 0.4% of its TVL — and it would bend the curve. Exchanges
// and bridges are out by the house's own rule. On the sealed snapshot
// that leaves 89 comps.
//
// What changed since radar-4: the slope is shrunk halfway toward 0.5
// (a prior, not a fit), with the intercept refit afterwards. The plain
// OLS slope, 0.63, is steeper than the 0.47–0.56 the top of the
// leaderboard reports, and the shrinkage is the one change that
// measurably improves the out-of-sample median miss: leave-one-out
// ×2.75 → ×2.66, time-split ×2.51 → ×2.31, at a cost of 0.006 of R²
// on each — inside noise. The shrink is applied at every fit (the
// full fit, each leave-one-out fold, the time-split fit and every
// bootstrap refit), so the board, its bands and its odds all come from
// the same estimator. Category effects were re-tested on the time
// split and failed there too, and a Huber robust fit was tried and
// rejected — the hard ratio screen stays the model.
//
// What the curve is tested against, all computed from the snapshot
// alone: leave-one-out (fit on 88, predict the held-out token), a
// time split (fit on tokens listed before 2024, test on the ones
// listed since), and a flat mcap/TVL multiple as the naive baseline.
//
// Every row's value is a distribution, not a point: the curve is refit
// on 200 bootstrap resamples of the comps (seeded, so the run is
// deterministic), and each row carries its P25–P75 band, its rank
// range across those refits, and its break-even odds — the share of
// refits in which the farm pays back more than it costs.
//
// The farm plan is netted to the dollar. A $1,000 deposit's slice is
// what it would get if 10% of the launch went to depositors pro rata;
// the plan's own slice, minus gas and the forgone 4% T-bill yield, is
// its net. FARM beats the T-bill, THIN beats the fees only, SKIP does
// not beat the fees. The verdict is computed, never asserted.

import { createHash } from 'node:crypto';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Everything the model assumes, in one place, so the dashboard can
 *  show the same numbers the board was priced from. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  farmer_share: number;
  tbill_apr: number;
  ticket_usd: number;
  setup_gas_usd: number;
  weekly_gas_usd: number;
  expensive_setup_gas_usd: number;
  expensive_weekly_gas_usd: number;
  ratio_lo: number;
  ratio_hi: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
  time_split_cutoff: string;
  /** The slope prior the fitted slope is shrunk toward, and the weight
   *  the fitted slope keeps: slope = weight * ols + (1 - weight) * prior. */
  slope_prior: number;
  slope_weight: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.6,
  maturity_scale_days: 240,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
  farmer_share: 0.1,
  tbill_apr: 0.04,
  ticket_usd: 1000,
  setup_gas_usd: 0.5,
  weekly_gas_usd: 0.15,
  expensive_setup_gas_usd: 5,
  expensive_weekly_gas_usd: 2,
  ratio_lo: 0.01,
  ratio_hi: 10,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
  time_split_cutoff: '2024-01-01',
  slope_prior: 0.5,
  slope_weight: 0.5,
};

export const MODEL_VERSION = 'radar-5';
export const LIVE_ROWS = 128;

/** Categories that cannot be comps: exchanges and bridges, the house rule. */
export const COMPS_EXCLUDED_CATEGORIES = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
]);

export interface CompsFit {
  n: number;
  screened_out: number;
  intercept: number;
  slope: number;
  /** The plain OLS pair, before shrinkage, so the shrink is checkable. */
  ols_intercept: number;
  ols_slope: number;
  r2: number;
  loo_median_factor: number;
  loo_within_3x: number;
  loo_r2: number;
  loo_rho: number;
  ts_n: number;
  ts_median_factor: number;
  ts_r2: number;
  flat_median_factor: number;
  bootstrap: Array<{ intercept: number; slope: number }>;
}

export interface CompsPoint {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  predicted_usd: number;
}

export interface ScreenedPoint {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

export interface FarmStep { text: string; cost: string; time: string; }

/** Chains where a transaction costs dollars, not cents. A farm uses the
 *  protocol's cheapest chain when it has one; only a protocol that lives
 *  on expensive chains alone pays mainnet gas. */
export const EXPENSIVE_CHAINS = new Set(['Ethereum', 'Bitcoin']);

export interface FarmEconomics {
  ticket: number;
  hold_days: number;
  weeks: number;
  farm_chain: string;
  expensive_gas: boolean;
  setup_gas: number;
  weekly_gas: number;
  total_gas: number;
  outlay: number;
  slice_1k: number;
  slice_plan: number;
  tbill: number;
  net_fees: number;
  net_all: number;
  hands_on_hours: number;
  net_per_hour: number;
  verdict: Verdict;
}

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number;
  curve_value: number;
  growth_multiplier: number; maturity_multiplier: number; breadth_multiplier: number;
  p25_usd: number; p75_usd: number; rank_low: number; rank_high: number;
  slice_1k_usd: number; net_all_usd: number; net_per_hour_usd: number;
  break_even_odds: number; verdict: Verdict;
  ticket_usd: number; outlay_usd: number; hold_days: number;
  farm_chain: string; setup_gas_usd: number; weekly_gas_usd: number; expensive_gas: boolean;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; curve_value: number;
  growth_multiplier: number; maturity_multiplier: number; breadth_multiplier: number;
  p25_usd: number; p75_usd: number; rank_low: number; rank_high: number;
  slice_1k_usd: number; net_all_usd: number; net_per_hour_usd: number;
  break_even_odds: number; verdict: Verdict;
  ticket_usd: number; outlay_usd: number; hold_days: number;
  farm_chain: string; setup_gas_usd: number; weekly_gas_usd: number; expensive_gas: boolean;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}

export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; comps_fit: CompsFit; watchlist_size: number; board_size: number;
  early_size: number; live_size: number;
  verdict_counts: { farm: number; thin: number; skip: number };
  rows: RadarRow[]; live: LiveRow[]; comps: CompsPoint[];
  screened: ScreenedPoint[]; set_aside: SetAsideRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const LOG3 = Math.log10(3);

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function middle(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function ranked(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  order.forEach(([, i], pos) => { ranks[i] = pos + 1; });
  return ranks;
}
export function spearman(xs: number[], ys: number[]): number {
  const rx = ranked(xs);
  const ry = ranked(ys);
  const n = xs.length;
  const mean = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mean) * (ry[i]! - mean);
    dx += (rx[i]! - mean) ** 2;
    dy += (ry[i]! - mean) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
/** Deterministic PRNG (mulberry32) so the bootstrap refits are the same on every run. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A traded protocol whose token is priced off its TVL, within a hundredfold band. */
export function isComp(p: SnapshotProtocol): boolean {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return false;
  if (p.category !== null && COMPS_EXCLUDED_CATEGORIES.has(p.category)) return false;
  const ratio = p.mcap_usd / p.tvl_usd;
  return ratio >= MODEL.ratio_lo && ratio <= MODEL.ratio_hi;
}
/** Traded and in a comparable line of business, before the ratio screen. */
export function isCompCandidate(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 &&
    (p.category === null || !COMPS_EXCLUDED_CATEGORIES.has(p.category));
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
/** A protocol that is somebody else's product, not a launch of its own. */
export function isSomeonesProduct(p: SnapshotProtocol): boolean {
  return p.category === 'CEX' || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) ||
    EXCHANGE_START.test(p.name) ||
    (p.category !== null && COMPS_EXCLUDED_CATEGORIES.has(p.category)) ||
    p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC';
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isSomeonesProduct(p);
}
export function setAsideReason(p: SnapshotProtocol): string {
  if (p.category === 'CEX') return 'exchange: its token, if any, is the exchange\u2019s own';
  if (VERSIONED.test(p.name)) return 'versioned name: a version of a protocol, not a launch of its own';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product of a token that already trades';
  if (EXCHANGE_START.test(p.name)) return 'exchange-branded product';
  if (p.category !== null && COMPS_EXCLUDED_CATEGORIES.has(p.category)) return 'bridge: it moves other tokens, it does not launch one';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'staked product of a token that already trades';
  return 'not rankable';
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

interface Line { intercept: number; slope: number; }

/** Plain least squares of log10(market cap) on log10(TVL). Returns null
 *  when the TVLs carry no spread. */
function olsLine(xs: number[], ys: number[]): (Line & { mx: number; my: number }) | null {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope, mx, my };
}

/**
 * The one estimator this entry uses everywhere: least squares, then the
 * slope is pulled halfway toward the 0.5 prior and the intercept is
 * refit through the data's centre, so the shrunken line still passes
 * through (mean log TVL, mean log mcap). Every fit in this file —
 * the full fit, each leave-one-out fold, the time-split fit and every
 * bootstrap refit — goes through here, so the board, its bands and its
 * validation all come from the same estimator.
 */
export function fitCurve(points: SnapshotProtocol[], model: ModelConstants = MODEL): Line | null {
  const xs = points.map((p) => Math.log10(Math.max(1, p.tvl_usd)));
  const ys = points.map((p) => Math.log10(p.mcap_usd!));
  const base = olsLine(xs, ys);
  if (base === null) return null;
  const slope = model.slope_weight * base.slope + (1 - model.slope_weight) * model.slope_prior;
  return { intercept: base.my - slope * base.mx, slope };
}
function logTvl(p: SnapshotProtocol): number {
  return Math.log10(Math.max(1, p.tvl_usd));
}
function logMcap(p: SnapshotProtocol): number {
  return Math.log10(p.mcap_usd!);
}
function rSquared(ys: number[], preds: number[]): number {
  const mean = ys.reduce((a, v) => a + v, 0) / ys.length;
  const ssRes = ys.reduce((s, v, i) => s + (v - preds[i]!) ** 2, 0);
  const ssTot = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
  return 1 - ssRes / ssTot;
}

/**
 * Fit the curve on the snapshot's own traded tokens and prove it three
 * ways before it prices anything: leave-one-out over the comps, a time
 * split (fit before 2024, test on the tokens listed since), and a flat
 * mcap/TVL multiple as the naive baseline. The bootstrap refits are
 * kept for the board's bands and break-even odds.
 */
export function fitComps(snapshot: Snapshot): CompsFit {
  const candidates = snapshot.protocols.filter(isCompCandidate);
  const comps = snapshot.protocols.filter(isComp);
  if (comps.length < 10) throw new SnapshotError(`snapshot carries ${comps.length} comps: too few to fit a curve`);
  const xs = comps.map(logTvl);
  const ys = comps.map(logMcap);
  const fit = fitCurve(comps);
  if (fit === null) throw new SnapshotError('comps carry no spread in TVL: the curve cannot be fitted');
  const plain = olsLine(xs, ys)!;
  const fullR2 = rSquared(ys, xs.map((x) => fit.intercept + fit.slope * x));
  // Leave-one-out: every comp predicted once, never from its own training set.
  const looErrs: number[] = [];
  const looPreds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = fitCurve(train);
    if (f === null) throw new SnapshotError('leave-one-out refit failed');
    const pred = f.intercept + f.slope * logTvl(comps[i]!);
    looPreds.push(pred);
    looErrs.push(Math.abs(pred - logMcap(comps[i]!)));
  }
  const looMedian = middle(looErrs);
  const looR2 = rSquared(ys, looPreds);
  // Time split: fit on the tokens listed before 2024, test on the ones listed since.
  const cut = Date.parse(`${MODEL.time_split_cutoff}T00:00:00Z`);
  const trainTs = comps.filter((p) => p.listed_at === null || Date.parse(`${p.listed_at}T00:00:00Z`) < cut);
  const testTs = comps.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) >= cut);
  let tsMedianFactor = 0;
  let tsR2 = 0;
  if (testTs.length >= 5) {
    const fTs = fitCurve(trainTs);
    if (fTs !== null) {
      const errs = testTs.map((p) => Math.abs(fTs.intercept + fTs.slope * logTvl(p) - logMcap(p))).sort((a, b) => a - b);
      tsMedianFactor = round2(10 ** middle(errs));
      const ty = testTs.map(logMcap);
      tsR2 = round4(rSquared(ty, testTs.map((p) => fTs.intercept + fTs.slope * logTvl(p))));
    }
  }
  // The naive baseline, leave-one-out as well: one flat mcap/TVL multiple.
  const flatErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const ratios = train.map((p) => logMcap(p) - logTvl(p)).sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)]!;
    flatErrs.push(Math.abs(logTvl(comps[i]!) + med - logMcap(comps[i]!)));
  }
  // Bootstrap refits for the board's bands: resample the comps with
  // replacement, refit through the same estimator, keep the pair.
  // Seeded, so the board is identical on every run of the same snapshot.
  const draw = seededRandom(MODEL.bootstrap_seed);
  const bootstrap: Array<{ intercept: number; slope: number }> = [];
  let guard = 0;
  while (bootstrap.length < MODEL.bootstrap_refits && guard < MODEL.bootstrap_refits * 20) {
    guard++;
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(draw() * comps.length)]!);
    const f = fitCurve(sample);
    if (f !== null) bootstrap.push({ intercept: round6(f.intercept), slope: round6(f.slope) });
  }
  return {
    n: comps.length,
    screened_out: candidates.length - comps.length,
    intercept: round6(fit.intercept),
    slope: round6(fit.slope),
    ols_intercept: round6(plain.intercept),
    ols_slope: round6(plain.slope),
    r2: round4(fullR2),
    loo_median_factor: round2(10 ** looMedian),
    loo_within_3x: round4(looErrs.filter((e) => e <= LOG3).length / looErrs.length),
    loo_r2: round4(looR2),
    loo_rho: round4(spearman(looPreds, ys)),
    ts_n: testTs.length,
    ts_median_factor: tsMedianFactor,
    ts_r2: tsR2,
    flat_median_factor: round2(10 ** middle(flatErrs)),
    bootstrap,
  };
}

export function curveValue(tvlUsd: number, fit: CompsFit): number {
  return Math.max(1, Math.round(10 ** (fit.intercept + fit.slope * Math.log10(Math.max(1, tvlUsd)))));
}
function curveValueAt(tvlUsd: number, intercept: number, slope: number): number {
  return Math.max(1, 10 ** (intercept + slope * Math.log10(Math.max(1, tvlUsd))));
}

/** The three stated priors that move a protocol off its curve value. */
export function multipliers(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): { growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finiteNumber(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = 1 - (1 - model.maturity_floor) * Math.exp(-ageForModel / model.maturity_scale_days);
  const chainCount = Math.max(1, protocol.chains.length);
  const breadthMult = 1 + Math.min(chainCount - 1, model.breadth_max_chains - 1) * model.breadth_per_chain;
  return { growthPct, growthMult, maturityMult, breadthMult, age };
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, fit: CompsFit, model: ModelConstants = MODEL): { implied: number; curve: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const m = multipliers(protocol, asOf, model);
  const curve = curveValue(protocol.tvl_usd, fit);
  const implied = Math.max(1, Math.round(curve * m.growthMult * m.maturityMult * m.breadthMult));
  return { implied, curve, ...m };
}

function holdFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 90) return 120;
  if (age < 365) return 90;
  return 60;
}

/**
 * The farm's net, in dollars, on a $1,000 deposit — the same unit the
 * slice is quoted in, so the verdict follows from the numbers on the
 * row. Gas is priced for the chain the farm actually uses: a few cents
 * a transaction on a rollup ($0.50 to set up, $0.15 a week), dollars
 * on Ethereum or Bitcoin mainnet ($5 to set up, $2 a week) — and a
 * protocol that lives on an expensive chain alone is where the fees
 * eat the drop. The forgone yield is a 4% T-bill on the $1,000 over
 * the hold. FARM clears the T-bill, THIN clears the fees only, SKIP
 * does not clear the fees.
 */
export function farmEconomics(p: SnapshotProtocol, implied: number, age: number | null, model: ModelConstants = MODEL): FarmEconomics {
  const ticket = model.ticket_usd;
  const hold = holdFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const farmChain = p.chains.find((c) => !EXPENSIVE_CHAINS.has(c)) ?? chainOf(p);
  const expensive = p.chains.length > 0 && p.chains.every((c) => EXPENSIVE_CHAINS.has(c));
  const setupGas = expensive ? model.expensive_setup_gas_usd : model.setup_gas_usd;
  const weeklyGas = expensive ? model.expensive_weekly_gas_usd : model.weekly_gas_usd;
  const totalGas = setupGas + weeklyGas * weeks;
  const outlay = ticket + totalGas;
  const slice1k = (1000 * model.farmer_share * implied) / Math.max(1, p.tvl_usd);
  const slicePlan = slice1k;
  const tbill = model.tbill_apr * ticket * (hold / 365);
  const netFees = slicePlan - totalGas;
  const netAll = netFees - tbill;
  const handsOn = 0.25 + weeks * (10 / 60) + 10 / 60;
  const verdict: Verdict = netAll > 0 ? 'FARM' : netFees > 0 ? 'THIN' : 'SKIP';
  return {
    ticket, hold_days: hold, weeks, farm_chain: farmChain, expensive_gas: expensive,
    setup_gas: setupGas, weekly_gas: weeklyGas, total_gas: round2(totalGas), outlay: round2(outlay),
    slice_1k: round2(slice1k), slice_plan: round2(slicePlan), tbill: round2(tbill),
    net_fees: round2(netFees), net_all: round2(netAll),
    hands_on_hours: round2(handsOn), net_per_hour: round2(netAll / handsOn), verdict,
  };
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function actionFor(p: SnapshotProtocol, ticket: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${ticket} of USDC on ${name} (${chain}) and leave the deposit working.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${ticket} of liquidity to ${name}'s main pool on ${chain} and leave it in.`;
  if (c.includes('bridge')) return `Bridge $${ticket} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${ticket} through ${name} and hold on to the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${ticket} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${ticket} on ${name} and take one position in a market that settles after the hold.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${ticket} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or hold $${ticket} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${ticket} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${ticket} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('launchpad')) return `Take ${name}'s next launch on ${chain} with $${ticket} and finish every item on its checklist.`;
  if (c.includes('ai') || c.includes('agent')) return `Run ${name} on ${chain} with $${ticket} and complete one agent task a week.`;
  return `Deposit $${ticket} of USDC into ${name} on ${chain} and leave the position open.`;
}
function secondActionFor(p: SnapshotProtocol, ticket: number): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.max(10, Math.round(ticket / 5))} on ${p.name} each week, so the wallet shows trading as well as a deposit.`;
  if (c.includes('lend')) return `Borrow $${Math.max(10, Math.round(ticket / 4))} against the deposit once and repay it, so the wallet shows borrowing as well as lending.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back the other way once a month, so the wallet shows two-way use.`;
  return `Use a second feature of ${p.name} once a week — a swap, a vote or a claim — so the wallet is more than one deposit.`;
}

export interface FarmContext { age: number | null; rank: number; implied: number; econ: FarmEconomics; odds: number; }

export function farmSteps(p: SnapshotProtocol, ctx: FarmContext): FarmStep[] {
  const chain = ctx.econ.farm_chain;
  const e = ctx.econ;
  const weeklyCost = `about $${e.weekly_gas} of gas a week`;
  const firstCost = e.expensive_gas ? 'about $5 of gas for the first transaction' : 'under $1 of gas for the first transaction';
  const verdictLine = e.verdict === 'FARM'
    ? `Verdict: FARM — the slice clears the gas and the forgone T-bill yield.`
    : e.verdict === 'THIN'
      ? `Verdict: THIN — the slice clears the gas but not the forgone T-bill yield.`
      : `Verdict: SKIP — the gas alone eats the slice.`;
  return [
    { text: `Open a fresh wallet for this farm only, fund it with what the plan asks for, and keep its seed phrase offline.`, cost: firstCost, time: '5 minutes' },
    { text: actionFor(p, e.ticket, chain), cost: `$${e.ticket} of capital and about $${e.setup_gas} of gas`, time: '15 minutes to set up' },
    { text: secondActionFor(p, e.ticket), cost: weeklyCost, time: '10 minutes a week' },
    { text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — and never leave the wallet idle for a full month.`, cost: weeklyCost, time: '10 minutes a week' },
    { text: `Hold the position for at least ${e.hold_days} days, so the activity lands in more than one snapshot.`, cost: `the $${e.ticket} stays in the position`, time: `${e.hold_days} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Log the wallet, the dates and every transaction, and check the log against the protocol's own activity page before you unwind.`, cost: 'nothing but the log', time: '5 minutes' },
    { text: `${verdictLine} The plan: $${e.ticket} ticket, about $${e.total_gas} gas over ${e.weeks} weeks, ${e.hold_days}-day hold, about $${e.outlay} all in. The launch's slice for this deposit is $${e.slice_1k.toFixed(2)}; after gas and the 4% T-bill the net is $${e.net_all.toFixed(2)} (${e.net_per_hour >= 0 ? '+' : ''}$${e.net_per_hour.toFixed(2)} per hands-on hour). The launch pays back more than the outlay in ${ctx.odds}% of the curve's refits.`, cost: `about $${e.outlay} all in`, time: `${e.hold_days} days` },
  ];
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, fit: CompsFit, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every rankable pre-token protocol, no floor and no size cap: the
  // watchlist is the floor, never the ceiling.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const econ = farmEconomics(p, v.implied, v.age, model);
    const mult = v.growthMult * v.maturityMult * v.breadthMult;
    return { p, ...v, econ, mult };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  // One bootstrap pass gives every row its band, its rank range and its
  // break-even odds, all from the same 200 refits of the curve.
  const n = scored.length;
  const bandValues: number[][] = scored.map(() => []);
  const rankValues: number[][] = scored.map(() => []);
  const beats: number[] = scored.map(() => 0);
  for (const refit of fit.bootstrap) {
    const values = scored.map((s) => Math.max(1, Math.round(curveValueAt(s.p.tvl_usd, refit.intercept, refit.slope) * s.mult)));
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || (scored[a[1]]!.p.slug < scored[b[1]]!.p.slug ? -1 : 1));
    order.forEach(([_, i], pos) => { rankValues[i]!.push(pos + 1); });
    for (let i = 0; i < n; i++) {
      bandValues[i]!.push(values[i]!);
      const s = scored[i]!;
      const slicePlan = (1000 * model.farmer_share * values[i]! / Math.max(1, s.p.tvl_usd)) * (s.econ.ticket / 1000);
      if (slicePlan - s.econ.total_gas - s.econ.tbill > 0) beats[i]!++;
    }
  }
  return scored.map((s, i) => {
    const rank = i + 1;
    const band = [...bandValues[i]!].sort((a, b) => a - b);
    const ranks = [...rankValues[i]!].sort((a, b) => a - b);
    const odds = Math.round((beats[i]! / Math.max(1, fit.bootstrap.length)) * 100);
    const ctx: FarmContext = { age: s.age, rank, implied: s.implied, econ: s.econ, odds };
    return {
      rank, slug: s.p.slug, name: s.p.name, category: s.p.category,
      chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
      symbol: s.p.symbol, token_status: 'pre-token' as const, age_days: s.age,
      implied_value_usd: s.implied,
      curve_value: s.curve,
      growth_multiplier: round4(s.growthMult), maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      p25_usd: percentile(band, 0.25), p75_usd: percentile(band, 0.75),
      rank_low: percentile(ranks, 0.1), rank_high: percentile(ranks, 0.9),
      slice_1k_usd: s.econ.slice_1k, net_all_usd: s.econ.net_all,
      net_per_hour_usd: s.econ.net_per_hour, break_even_odds: odds, verdict: s.econ.verdict,
      ticket_usd: s.econ.ticket, outlay_usd: s.econ.outlay, hold_days: s.econ.hold_days,
      farm_chain: s.econ.farm_chain, setup_gas_usd: s.econ.setup_gas, weekly_gas_usd: s.econ.weekly_gas,
      expensive_gas: s.econ.expensive_gas,
      farm_steps: farmSteps(s.p, ctx).map(stepText),
    };
  });
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
export function compsRows(snapshot: Snapshot, fit: CompsFit): CompsPoint[] {
  return snapshot.protocols
    .filter(isComp)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, predicted_usd: curveValue(p.tvl_usd, fit) }));
}
export function screenedRows(snapshot: Snapshot): ScreenedPoint[] {
  return snapshot.protocols
    .filter((p) => isCompCandidate(p) && !isComp(p))
    .sort((a, b) => (b.mcap_usd! / b.tvl_usd) - (a.mcap_usd! / a.tvl_usd))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: round4(p.mcap_usd! / p.tvl_usd) }));
}
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p) }));
}
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    mcap_usd: row.mcap_usd, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd, curve_value: row.curve_value,
    growth_multiplier: row.growth_multiplier,
    maturity_multiplier: row.maturity_multiplier,
    breadth_multiplier: row.breadth_multiplier,
    p25_usd: row.p25_usd, p75_usd: row.p75_usd,
    rank_low: row.rank_low, rank_high: row.rank_high,
    slice_1k_usd: row.slice_1k_usd, net_all_usd: row.net_all_usd,
    net_per_hour_usd: row.net_per_hour_usd, break_even_odds: row.break_even_odds,
    verdict: row.verdict, ticket_usd: row.ticket_usd,
    outlay_usd: row.outlay_usd, hold_days: row.hold_days,
    farm_chain: row.farm_chain, setup_gas_usd: row.setup_gas_usd,
    weekly_gas_usd: row.weekly_gas_usd, expensive_gas: row.expensive_gas,
    watchlist: watchlist.has(row.slug),
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const comps = compsRows(snapshot, fit);
  const screened = screenedRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdictCounts = {
    farm: board.filter((r) => r.verdict === 'FARM').length,
    thin: board.filter((r) => r.verdict === 'THIN').length,
    skip: board.filter((r) => r.verdict === 'SKIP').length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, comps_fit: fit, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    verdict_counts: verdictCounts,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))), live, comps, screened, set_aside: setAside,
  };
  return { board, radar };
}
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (!Number.isSafeInteger(o.floor_usd) || (o.floor_usd as number) <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.verdict !== 'FARM' && r.verdict !== 'THIN' && r.verdict !== 'SKIP') return `${r.slug} has no farm verdict`;
    if (!(r.p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.p75_usd)) return `${r.slug} has its implied value outside its P25-P75 band`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// A checksum of the board, so a reader can tell whether the board.json
// they hold is the one this program wrote from this snapshot.
export function boardChecksum(board: BoardRow[]): string {
  const h = createHash('sha256');
  for (const r of board) h.update(`${r.rank}:${r.slug}:${r.implied_value_usd}:${r.verdict};`);
  return h.digest('hex').slice(0, 16);
}
