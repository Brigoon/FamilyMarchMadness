'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scorePicks, ROUND_ORDER, getEliminatedTeams } = require('./helpers/load-app');
const gen = require('./helpers/bracket-gen');
const { readJSON, DEFAULT_TOURNAMENT } = require('./helpers/fixtures');

const T = readJSON(DEFAULT_TOURNAMENT);
const TOTAL = gen.totalPoints(T);
const GAMES = gen.buildGames(T).length; // 75

const score = (picks, results) => {
  const s = scorePicks({ submitter: 'T', ...picks }, results, T);
  return { score: s.currentScore, maxPossible: s.maxPossible };
};

// Fixed seeds keep failures reproducible; the seed is in every failure message.
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i);

test('engine matches the independent reference for random brackets at random points in the tournament', () => {
  for (const seed of SEEDS) {
    const rand = gen.makeRng(seed);
    const truth = gen.randomBracket(T, rand);
    const picks = gen.randomBracket(T, rand);
    const results = gen.firstGames(T, truth, Math.floor(rand() * (GAMES + 1)));

    const ref = gen.breakdown(T, picks, results);
    assert.deepEqual(score(picks, results), { score: ref.score, maxPossible: ref.maxPossible }, `seed ${seed}`);
  }
});

test('engine eliminates exactly the same teams as the reference', () => {
  for (const seed of SEEDS) {
    const rand = gen.makeRng(seed);
    const truth = gen.randomBracket(T, rand);
    const results = gen.firstGames(T, truth, Math.floor(rand() * (GAMES + 1)));
    assert.deepEqual([...getEliminatedTeams(results, T)].sort(), [...gen.eliminatedOracle(T, results)].sort(), `seed ${seed}`);
  }
});

test('a perfect bracket can always still reach the full 132', () => {
  for (const seed of SEEDS) {
    const truth = gen.randomBracket(T, gen.makeRng(seed));
    for (let k = 0; k <= GAMES; k += 5) {
      const results = gen.firstGames(T, truth, k);
      const s = score(truth, results);
      assert.equal(s.maxPossible, TOTAL, `seed ${seed}, ${k} games played`);
      assert.equal(s.score, gen.breakdown(T, truth, results).score, `seed ${seed}, ${k} games played`);
    }
  }
});

test('score never exceeds max possible, and both stay within 0..132', () => {
  for (const seed of SEEDS) {
    const rand = gen.makeRng(seed);
    const truth = gen.randomBracket(T, rand);
    const picks = gen.randomBracket(T, rand);
    for (let k = 0; k <= GAMES; k++) {
      const s = score(picks, gen.firstGames(T, truth, k));
      assert.ok(s.score >= 0 && s.score <= s.maxPossible && s.maxPossible <= TOTAL, `seed ${seed}, ${k} games: ${JSON.stringify(s)}`);
    }
  }
});

test('as games are played, score never drops and max possible never rises', () => {
  for (const seed of SEEDS) {
    const rand = gen.makeRng(seed);
    const truth = gen.randomBracket(T, rand);
    const picks = gen.randomBracket(T, rand);
    let prev = score(picks, gen.firstGames(T, truth, 0));
    for (let k = 1; k <= GAMES; k++) {
      const cur = score(picks, gen.firstGames(T, truth, k));
      assert.ok(cur.score >= prev.score, `seed ${seed}, game ${k}: score dropped`);
      assert.ok(cur.maxPossible <= prev.maxPossible, `seed ${seed}, game ${k}: max possible rose`);
      prev = cur;
    }
  }
});

test('once every game is played, max possible equals score', () => {
  for (const seed of SEEDS) {
    const rand = gen.makeRng(seed);
    const truth = gen.randomBracket(T, rand);
    const picks = gen.randomBracket(T, rand);
    const s = score(picks, truth);
    assert.equal(s.maxPossible, s.score, `seed ${seed}`);
  }
});

test('with no games played, every complete bracket has max possible 132 and score 0', () => {
  for (const seed of SEEDS) {
    const picks = gen.randomBracket(T, gen.makeRng(seed));
    assert.deepEqual(score(picks, gen.emptyShape()), { score: 0, maxPossible: TOTAL }, `seed ${seed}`);
  }
});

test('every stage truncation covers the rounds in order', () => {
  // Sanity check on the helper the other tests rely on.
  const truth = gen.chalk(T);
  let prevGames = -1;
  for (const round of ROUND_ORDER) {
    const n = Object.keys(gen.winnersOf(T, gen.throughRound(T, truth, round))).length;
    assert.ok(n > prevGames, `${round} should add games`);
    prevGames = n;
  }
  assert.equal(prevGames, GAMES);
});
