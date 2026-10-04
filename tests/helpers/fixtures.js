'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROUND_ORDER } = require('./load-app');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const MANUAL_DIR = path.join(FIXTURES_DIR, 'manual');
const DEFAULT_TOURNAMENT = path.join(FIXTURES_DIR, 'tournament-76.json');

/** Stages a fixture can check: end of each round, or 'final' for the results exactly as given. */
const STAGES = [...ROUND_ORDER, 'final'];

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Names of fixture files in tests/fixtures/manual (files starting with _ are ignored). */
function listManualFixtures() {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs.readdirSync(MANUAL_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
}

/** Load a fixture and its tournament (default: the frozen 76-team field). */
function loadFixture(file) {
  const fixture = readJSON(file);
  const tournamentPath = fixture.tournament
    ? path.resolve(path.dirname(file), fixture.tournament)
    : DEFAULT_TOURNAMENT;
  return { fixture, tournament: readJSON(tournamentPath) };
}

/** Throws a descriptive Error if a fixture is malformed. */
function validateFixture(fixture, label) {
  const fail = msg => { throw new Error(`${label}: ${msg}`); };
  if (!fixture.results || typeof fixture.results !== 'object') fail('missing "results"');
  if (!Array.isArray(fixture.brackets) || fixture.brackets.length === 0) fail('"brackets" must be a non-empty array');
  fixture.brackets.forEach((b, i) => {
    if (!b.name) fail(`bracket #${i + 1} has no "name"`);
    if (!b.picks || typeof b.picks !== 'object') fail(`bracket "${b.name}" has no "picks"`);
    if (!b.expected || Object.keys(b.expected).length === 0) fail(`bracket "${b.name}" has no "expected"`);
    for (const [stage, exp] of Object.entries(b.expected)) {
      if (!STAGES.includes(stage)) fail(`bracket "${b.name}": unknown stage "${stage}" (use ${STAGES.join(', ')})`);
      if (!Number.isInteger(exp.score) || !Number.isInteger(exp.maxPossible)) {
        fail(`bracket "${b.name}" stage "${stage}": expected needs integer "score" and "maxPossible"`);
      }
    }
  });
}

module.exports = { FIXTURES_DIR, MANUAL_DIR, DEFAULT_TOURNAMENT, STAGES, readJSON, listManualFixtures, loadFixture, validateFixture };
