'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const gen = require('./helpers/bracket-gen');
const { readJSON, DEFAULT_TOURNAMENT } = require('./helpers/fixtures');
const { validateTournament, validateResults } = require('./helpers/validate');

// Change these if the field size changes in a future season.
const EXPECTED = { teams: 76, openingGames: 12 };

const ROOT = path.join(__dirname, '..');
const liveTournament = readJSON(path.join(ROOT, 'tournament.json'));
const liveResults = readJSON(path.join(ROOT, 'results.json'));

const none = problems => assert.deepEqual(problems, [], `\n  - ${problems.join('\n  - ')}`);

// ── Live files: these are what the site actually uses ─────────────────────────

test('tournament.json is a valid 76-team field', () => none(validateTournament(liveTournament, EXPECTED)));

test('results.json only contains real games and real winners', () => none(validateResults(liveTournament, liveResults)));

// ── The validators themselves ─────────────────────────────────────────────────

const T = readJSON(DEFAULT_TOURNAMENT);
const clone = o => JSON.parse(JSON.stringify(o));

test('validator accepts the frozen fixture tournament and a full set of results', () => {
  none(validateTournament(T, EXPECTED));
  none(validateResults(T, gen.chalk(T)));
  none(validateResults(T, gen.emptyShape()));
});

test('validator catches a misspelled winner', () => {
  const r = gen.chalk(T);
  r.roundOf64.East_1 = 'East 1 Seeed';
  assert.ok(validateResults(T, r).some(p => p.includes('East 1 Seeed')));
});

test('validator catches a winner from the wrong game', () => {
  const r = gen.throughRound(T, gen.chalk(T), 'roundOf64');
  r.roundOf64.East_1 = 'West 1 Seed';
  assert.ok(validateResults(T, r).some(p => p.includes('did not play')));
});

test('validator catches a result entered before its feeder games', () => {
  const r = gen.emptyShape();
  r.roundOf32.East_1 = 'East 1 Seed';
  assert.ok(validateResults(T, r).some(p => p.includes('not decided')));
});

test('validator catches unknown slots and rounds', () => {
  const r = gen.emptyShape();
  r.roundOf64.East_9 = 'East 1 Seed';
  r.firstFour = {};
  const problems = validateResults(T, r);
  assert.ok(problems.some(p => p.includes('East_9')));
  assert.ok(problems.some(p => p.includes('firstFour')));
});

test('validator catches an incomplete or duplicated field', () => {
  const missing = clone(T);
  missing.teams = missing.teams.filter(t => !(t.region === 'East' && t.seed === 5));
  assert.ok(validateTournament(missing, EXPECTED).some(p => p.includes('missing seed 5')));

  const dupName = clone(T);
  dupName.teams[1].name = dupName.teams[0].name;
  assert.ok(validateTournament(dupName, EXPECTED).some(p => p.includes('duplicate team name')));

  const doubleSeed = clone(T);
  doubleSeed.teams.push({ name: 'Extra', seed: 16, region: 'East' });
  assert.ok(validateTournament(doubleSeed, EXPECTED).some(p => p.includes('filled twice')));

  const mismatched = clone(T);
  mismatched.openingRound[0].teams[1].seed = 15;
  assert.ok(validateTournament(mismatched, EXPECTED).some(p => p.includes('share a seed and region')));
});
