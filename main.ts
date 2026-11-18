// Token Radar radar-5 — a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the shrunken comps curve, proves it leave-one-out and on a time
// split, scores every pre-token protocol that is nobody else's product,
// writes the ranked board to /output/board.json and the dashboard's data
// beside it, copies this repository's dashboard/ and screenshots/ to
// /output, and writes /output/dossier.json with the vendored make.fun
// library — the same bytes the scorer rebuilds, so what the judge reads
// is exactly what this program wrote.
//
// radar-5 scores the whole watchlist plus every rankable pre-token
// protocol below and above the floor (197 rows on the sealed snapshot),
// prices each one off a log-log comps curve fitted on the 89 traded
// tokens whose market plainly prices their TVL — with the slope shrunk
// halfway toward 0.5 and the intercept refit — then adjusts for 7-day
// TVL growth, time tracked with no token, and chain breadth. Every row
// carries a P25–P75 band from 200 bootstrap refits of the curve, a
// rank range across those refits, and a farm verdict — FARM, THIN or
// SKIP — netted to the dollar against gas and the forgone 4% T-bill
// yield. The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardChecksum, boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputGiven = flagValue('input', '/input');
const inputFile = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const fit = radar.comps_fit;
const vc = radar.verdict_counts;
const top = board[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside, ${radar.set_aside.length} set aside), board ${boardChecksum(board)}\n` +
    `token radar: comps curve log10(mcap) = ${fit.intercept} + ${fit.slope} x log10(tvl) on ${fit.n} comps (${fit.screened_out} screened out by the ratio band), OLS ${fit.ols_intercept} + ${fit.ols_slope} x before the shrink, R2 ${fit.r2}, leave-one-out median error x${fit.loo_median_factor} (${Math.round(fit.loo_within_3x * 100)}% within 3x, LOO R2 ${fit.loo_r2}), time-split median error x${fit.ts_median_factor} (n=${fit.ts_n}, R2 ${fit.ts_r2}), flat multiple x${fit.flat_median_factor}\n` +
    `token radar: verdicts FARM ${vc.farm} / THIN ${vc.thin} / SKIP ${vc.skip}; top row ${top.name} $${top.implied_value_usd.toLocaleString('en-US')} (${top.verdict})\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
