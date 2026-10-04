'use strict';

/**
 * Independent model of the bracket used as a test oracle.
 * It deliberately does not reuse app.js's matchup or elimination logic.
 */

const { ROUND_ORDER, ROUND_POINTS } = require('./load-app');

// Own copy on purpose; a test checks it against app.js's SEED_MATCHUPS_64.
const R64_SEEDS = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];

const key = (round, slot) => `${round}|${slot}`;

function seedMap(tournament) {
  const map = {};
  for (const t of tournament.teams) map[t.name] = t.seed;
  for (const g of tournament.openingRound) for (const t of g.teams) map[t.name] = t.seed;
  return map;
}

/** Every game in play order. a/b are { team } (known entrant) or { game } (winner of that game key). */
function buildGames(tournament) {
  const games = [];
  const team = name => ({ team: name });
  const winnerOf = k => ({ game: k });

  for (const g of tournament.openingRound) {
    games.push({
      key: key('openingRound', g.id), round: 'openingRound', slot: g.id,
      a: team(g.teams[0].name), b: team(g.teams[1].name),
    });
  }

  const entrant = (region, seed) => {
    const opening = tournament.openingRound.find(g => g.teams[0].region === region && g.teams[0].seed === seed);
    if (opening) return winnerOf(key('openingRound', opening.id));
    return team(tournament.teams.find(t => t.region === region && t.seed === seed).name);
  };

  for (const r of tournament.regions) {
    R64_SEEDS.forEach(([sa, sb], i) => {
      const slot = `${r}_${i + 1}`;
      games.push({ key: key('roundOf64', slot), round: 'roundOf64', slot, a: entrant(r, sa), b: entrant(r, sb) });
    });
  }

  const feed = (round, slot, prev, s1, s2) =>
    games.push({ key: key(round, slot), round, slot, a: winnerOf(key(prev, s1)), b: winnerOf(key(prev, s2)) });

  for (const r of tournament.regions) for (let i = 1; i <= 4; i++) feed('roundOf32', `${r}_${i}`, 'roundOf64', `${r}_${2 * i - 1}`, `${r}_${2 * i}`);
  for (const r of tournament.regions) for (let i = 1; i <= 2; i++) feed('sweetSixteen', `${r}_${i}`, 'roundOf32', `${r}_${2 * i - 1}`, `${r}_${2 * i}`);
  for (const r of tournament.regions) feed('eliteEight', r, 'sweetSixteen', `${r}_1`, `${r}_2`);
  const [r0, r1, r2, r3] = tournament.regions;
  feed('finalFour', 'FF_1', 'eliteEight', r0, r2);
  feed('finalFour', 'FF_2', 'eliteEight', r1, r3);
  feed('championship', 'championship', 'finalFour', 'FF_1', 'FF_2');
  return games;
}

function resolve(ref, winners) {
  if (ref.team) return ref.team;
  const w = winners[ref.game];
  return w == null ? null : w;
}

function emptyShape() {
  return { openingRound: {}, roundOf64: {}, roundOf32: {}, sweetSixteen: {}, eliteEight: {}, finalFour: {}, championship: null };
}

/** { 'round|slot': winner } -> picks/results shape. */
function toShape(winners) {
  const shape = emptyShape();
  for (const [k, w] of Object.entries(winners)) {
    const [round, slot] = k.split('|');
    if (round === 'championship') shape.championship = w;
    else shape[round][slot] = w;
  }
  return shape;
}

/** picks/results shape -> { 'round|slot': winner } for every non-null entry. */
function winnersOf(tournament, shape) {
  const out = {};
  for (const g of buildGames(tournament)) {
    const v = g.round === 'championship' ? shape.championship : (shape[g.round] || {})[g.slot];
    if (v != null) out[g.key] = v;
  }
  return out;
}

/** Play out a whole bracket; choose(teamA, teamB, game) returns the winner's name. */
function simulate(tournament, choose) {
  const winners = {};
  for (const g of buildGames(tournament)) {
    winners[g.key] = choose(resolve(g.a, winners), resolve(g.b, winners), g);
  }
  return toShape(winners);
}

function chalk(tournament) {
  const seed = seedMap(tournament);
  return simulate(tournament, (a, b) => (seed[a] <= seed[b] ? a : b));
}

/** Higher seed number always wins; ties go to the second team. */
function underdog(tournament) {
  const seed = seedMap(tournament);
  return simulate(tournament, (a, b) => (seed[a] > seed[b] ? a : b));
}

/** Chalk, except `team` wins every game it plays. */
function chalkWith(tournament, teamName) {
  const seed = seedMap(tournament);
  return simulate(tournament, (a, b) => {
    if (a === teamName || b === teamName) return teamName;
    return seed[a] <= seed[b] ? a : b;
  });
}

function randomBracket(tournament, rand) {
  return simulate(tournament, (a, b) => (rand() < 0.5 ? a : b));
}

/** Keep only the first `count` games (play order) of a results shape. */
function firstGames(tournament, shape, count) {
  const all = winnersOf(tournament, shape);
  const kept = {};
  for (const g of buildGames(tournament).slice(0, count)) if (all[g.key] != null) kept[g.key] = all[g.key];
  return toShape(kept);
}

/** Keep results through the end of `round` ('final' keeps everything). */
function throughRound(tournament, shape, round) {
  if (round === 'final') return toShape(winnersOf(tournament, shape));
  const idx = ROUND_ORDER.indexOf(round);
  if (idx < 0) throw new Error(`Unknown stage "${round}"`);
  const rounds = new Set(ROUND_ORDER.slice(0, idx + 1));
  const all = winnersOf(tournament, shape);
  const kept = {};
  for (const g of buildGames(tournament)) if (rounds.has(g.round) && all[g.key] != null) kept[g.key] = all[g.key];
  return toShape(kept);
}

function totalPoints(tournament) {
  return buildGames(tournament).reduce((sum, g) => sum + ROUND_POINTS[g.round], 0);
}

/** Teams that played a decided game and did not win it. */
function eliminatedOracle(tournament, results) {
  const winners = winnersOf(tournament, results);
  const out = new Set();
  for (const g of buildGames(tournament)) {
    const w = winners[g.key];
    if (w == null) continue;
    for (const x of [resolve(g.a, winners), resolve(g.b, winners)]) if (x && x !== w) out.add(x);
  }
  return out;
}

/**
 * Per-round breakdown computed from first principles:
 *   earned    = points for decided games where the pick matches
 *   possible  = points for undecided games whose picked team is still alive
 */
function breakdown(tournament, picks, results) {
  const winners = winnersOf(tournament, results);
  const picked = winnersOf(tournament, picks);
  const dead = eliminatedOracle(tournament, results);
  const rows = ROUND_ORDER.map(round => ({
    round, points: ROUND_POINTS[round], decided: 0, correct: 0, earned: 0, undecided: 0, alive: 0, possible: 0,
  }));
  const byRound = Object.fromEntries(rows.map(r => [r.round, r]));

  for (const g of buildGames(tournament)) {
    const row = byRound[g.round];
    const w = winners[g.key];
    const p = picked[g.key];
    if (w != null) {
      row.decided++;
      if (p === w) { row.correct++; row.earned += row.points; }
    } else {
      row.undecided++;
      if (p != null && !dead.has(p)) { row.alive++; row.possible += row.points; }
    }
  }
  const score = rows.reduce((s, r) => s + r.earned, 0);
  const possible = rows.reduce((s, r) => s + r.possible, 0);
  return { rows, score, maxPossible: score + possible };
}

function formatBreakdown(b) {
  const pad = (v, n) => String(v).padStart(n);
  const lines = ['round          pts  decided  correct  earned  undecided  alive  possible'];
  for (const r of b.rows) {
    lines.push(`${r.round.padEnd(14)} ${pad(r.points, 3)}  ${pad(r.decided, 7)}  ${pad(r.correct, 7)}  ${pad(r.earned, 6)}  ${pad(r.undecided, 9)}  ${pad(r.alive, 5)}  ${pad(r.possible, 8)}`);
  }
  lines.push(`score ${b.score}, max possible ${b.maxPossible}`);
  return lines.join('\n');
}

/** Small seeded PRNG so random tests are reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  R64_SEEDS, buildGames, resolve, seedMap, emptyShape, toShape, winnersOf, simulate,
  chalk, underdog, chalkWith, randomBracket, firstGames, throughRound, totalPoints,
  eliminatedOracle, breakdown, formatBreakdown, makeRng,
};
