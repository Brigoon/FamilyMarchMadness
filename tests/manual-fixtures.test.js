'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scorePicks } = require('./helpers/load-app');
const gen = require('./helpers/bracket-gen');
const { MANUAL_DIR, listManualFixtures, loadFixture, validateFixture } = require('./helpers/fixtures');

// Every file in tests/fixtures/manual/ becomes tests automatically.
const files = listManualFixtures();

test('at least one manual fixture exists', () => {
  assert.ok(files.length > 0, 'add a fixture to tests/fixtures/manual/');
});

for (const file of files) {
  const { fixture, tournament } = loadFixture(path.join(MANUAL_DIR, file));

  test(`${file} is well-formed`, () => validateFixture(fixture, file));

  for (const bracket of fixture.brackets || []) {
    for (const [stage, expected] of Object.entries(bracket.expected || {})) {
      test(`${file} / ${bracket.name} / ${stage}`, () => {
        const results = gen.throughRound(tournament, fixture.results, stage);
        const picks = { submitter: bracket.name, ...bracket.picks };
        const s = scorePicks(picks, results, tournament);
        const actual = { score: s.currentScore, maxPossible: s.maxPossible };
        assert.deepEqual(actual, expected,
          `${bracket.name} at "${stage}": engine ${JSON.stringify(actual)} vs expected ${JSON.stringify(expected)}\n` +
          `Round-by-round from first principles:\n${gen.formatBreakdown(gen.breakdown(tournament, bracket.picks, results))}`);
      });
    }
  }
}
