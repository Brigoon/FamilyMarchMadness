'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./helpers/load-app');
const gen = require('./helpers/bracket-gen');
const { readJSON, DEFAULT_TOURNAMENT } = require('./helpers/fixtures');

const T = readJSON(DEFAULT_TOURNAMENT);
const { scorePicks, getEliminatedTeams, buildSlotIds, getPickStatus, buildSeasonSnapshot } = app;

const named = (shape, name) => ({ submitter: name, ...shape });
const score = (picks, results) => {
  const s = scorePicks(named(picks, 'T'), results, T);
  return { score: s.currentScore, maxPossible: s.maxPossible };
};

const CHALK = gen.chalk(T);

test('point values are 1/1/2/3/4/5/6 and a full bracket is worth 132', () => {
  assert.deepEqual(app.ROUND_POINTS, {
    openingRound: 1, roundOf64: 1, roundOf32: 2, sweetSixteen: 3, eliteEight: 4, finalFour: 5, championship: 6,
  });
  assert.equal(gen.totalPoints(T), 12 + 32 + 16 * 2 + 8 * 3 + 4 * 4 + 2 * 5 + 6);
  assert.equal(gen.totalPoints(T), 132);
});

test('app.js seed matchups match the independent model', () => {
  assert.deepEqual(app.SEED_MATCHUPS_64, gen.R64_SEEDS);
});

test('buildSlotIds lists 12/32/16/8/4/2/1 slots', () => {
  const slots = buildSlotIds(T);
  const counts = Object.fromEntries(Object.entries(slots).map(([r, s]) => [r, s.length]));
  assert.deepEqual(counts, {
    openingRound: 12, roundOf64: 32, roundOf32: 16, sweetSixteen: 8, eliteEight: 4, finalFour: 2, championship: 1,
  });
  assert.deepEqual(slots.openingRound, T.openingRound.map(g => g.id));
});

test('perfect bracket, full results: 132 / 132', () => {
  assert.deepEqual(score(CHALK, CHALK), { score: 132, maxPossible: 132 });
});

test('no results yet: score 0, everything still possible', () => {
  assert.deepEqual(score(CHALK, gen.emptyShape()), { score: 0, maxPossible: 132 });
});

test('empty picks never throw and score nothing', () => {
  assert.deepEqual(score({}, CHALK), { score: 0, maxPossible: 0 });
  assert.deepEqual(score({}, gen.emptyShape()), { score: 0, maxPossible: 0 });
});

test('null results count as undecided', () => {
  const results = gen.emptyShape();
  results.roundOf64.East_1 = null;
  results.championship = null;
  assert.deepEqual(score(CHALK, results), { score: 0, maxPossible: 132 });
});

test('every pick wrong: 0 / 0 once results are complete, 0 / 132 before any', () => {
  const wrong = gen.underdog(T);
  assert.deepEqual(score(wrong, CHALK), { score: 0, maxPossible: 0 });
  assert.deepEqual(score(wrong, gen.emptyShape()), { score: 0, maxPossible: 132 });
});

test('opening round played: correct picks earn 12, all 132 still possible', () => {
  const results = gen.throughRound(T, CHALK, 'openingRound');
  assert.deepEqual(score(CHALK, results), { score: 12, maxPossible: 132 });
});

test('picking an opening-round loser all the way to the title', () => {
  // East 16 Seed B loses OR1. Picks carrying it through lose: OR1 pick (1) already wrong,
  // then R64 1 + R32 2 + S16 3 + E8 4 + FF 5 + title 6 = 21 become impossible.
  // Score = 11 other correct opening picks; max = 11 + (132 - 12 - 21) = 110.
  const picks = gen.chalkWith(T, 'East 16 Seed B');
  const results = gen.throughRound(T, CHALK, 'openingRound');
  assert.deepEqual(score(picks, results), { score: 11, maxPossible: 110 });
});

test('upset pick carried to the title, results through the Round of 32', () => {
  // East 9 Seed wins R64 East_2 (wrong), R32 East_1 (wrong), then S16 East_1, E8 East, FF_1, title.
  // Decided: 12 opening + 31 R64 + 15 R32 x2 = 73.
  // Undecided picks still alive: 7 S16 x3 + 3 E8 x4 + FF_2 x5 = 38. Max = 111.
  const picks = gen.chalkWith(T, 'East 9 Seed');
  const results = gen.throughRound(T, CHALK, 'roundOf32');
  assert.deepEqual(score(picks, results), { score: 73, maxPossible: 111 });
});

test('champion pick still alive in the title game', () => {
  // Chalk finalists are East 1 Seed and West 1 Seed; the bracket picks West 1 Seed to win it all.
  const picks = gen.simulate(T, (a, b, g) => {
    if (g.round === 'championship') return 'West 1 Seed';
    const seed = gen.seedMap(T);
    return seed[a] <= seed[b] ? a : b;
  });
  const atFinal = gen.throughRound(T, CHALK, 'finalFour');
  assert.deepEqual(score(picks, atFinal), { score: 126, maxPossible: 132 });
  assert.deepEqual(score(picks, CHALK), { score: 126, maxPossible: 126 });
});

test('Final Four pairing: region 1 meets region 3, so the FF_1 loser is out', () => {
  // Picks South 1 Seed to beat East 1 Seed in FF_1 and win the title. FF_1 actually went to East.
  // Decided through the Final Four: 126 points, FF_1 pick wrong (-5) = 121. Title pick is dead: max 121.
  const seed = gen.seedMap(T);
  const picks = gen.simulate(T, (a, b, g) => {
    if (g.slot === 'FF_1' || g.round === 'championship') {
      if (a === 'South 1 Seed' || b === 'South 1 Seed') return 'South 1 Seed';
    }
    return seed[a] <= seed[b] ? a : b;
  });
  const results = gen.throughRound(T, CHALK, 'finalFour');
  assert.deepEqual(score(picks, results), { score: 121, maxPossible: 121 });
});

test('opening-round loser is eliminated', () => {
  const results = { openingRound: { OR1: 'East 16 Seed A' } };
  assert.deepEqual([...getEliminatedTeams(results, T)], ['East 16 Seed B']);
});

test('opening-round winner who then loses in the Round of 64 is eliminated', () => {
  const results = { openingRound: { OR1: 'East 16 Seed A' }, roundOf64: { East_1: 'East 1 Seed' } };
  assert.deepEqual([...getEliminatedTeams(results, T)].sort(), ['East 16 Seed A', 'East 16 Seed B']);
});

test('a Round of 64 result with its opening round unplayed eliminates nobody it cannot name', () => {
  const results = { roundOf64: { East_1: 'East 1 Seed' } };
  assert.equal(getEliminatedTeams(results, T).size, 0);
});

test('a team that lost in the Round of 32 is eliminated, its winner is not', () => {
  const results = gen.throughRound(T, CHALK, 'roundOf32');
  const out = getEliminatedTeams(results, T);
  assert.ok(out.has('East 8 Seed'));
  assert.ok(!out.has('East 1 Seed'));
});

test('pick status: correct, incorrect, pending, and eliminated-before-played', () => {
  const results = { openingRound: { OR1: 'East 16 Seed A' }, roundOf64: { East_1: 'East 1 Seed' } };
  const out = getEliminatedTeams(results, T);
  assert.equal(getPickStatus('roundOf64', 'East_1', 'East 1 Seed', results, out), 'correct');
  assert.equal(getPickStatus('roundOf64', 'East_1', 'East 16 Seed A', results, out), 'incorrect');
  assert.equal(getPickStatus('roundOf64', 'East_2', 'East 8 Seed', results, out), 'pending');
  assert.equal(getPickStatus('roundOf32', 'East_1', 'East 16 Seed B', results, out), 'incorrect');
  assert.equal(getPickStatus('roundOf64', 'East_2', undefined, results, out), 'pending');
  assert.equal(getPickStatus('championship', 'championship', 'East 1 Seed', { championship: 'East 1 Seed' }, out), 'correct');
});

test('Round of 64 matchups use the opening-round winner when known', () => {
  const before = app.buildR64Matchups('East', T, {});
  assert.equal(before[0].teamB, 'Winner of OR1');
  const after = app.buildR64Matchups('East', T, { openingRound: { OR1: 'East 16 Seed B' } });
  assert.equal(after[0].teamB, 'East 16 Seed B');
  assert.equal(after[0].seedB, 16);
  assert.equal(before.length, 8);
});

test('Hall of Fame snapshot shares ranks on ties and orders ties by name', () => {
  const scores = [
    { name: 'Cara', currentScore: 70 },
    { name: 'Bob', currentScore: 80 },
    { name: 'Al', currentScore: 80 },
  ];
  assert.deepEqual(buildSeasonSnapshot(scores, { championship: 'Duke' }, 2027), {
    year: 2027,
    champion: 'Duke',
    leaderboard: [
      { rank: 1, name: 'Al', score: 80 },
      { rank: 1, name: 'Bob', score: 80 },
      { rank: 3, name: 'Cara', score: 70 },
    ],
  });
  assert.equal(buildSeasonSnapshot(scores, {}, 2027).champion, null);
});
