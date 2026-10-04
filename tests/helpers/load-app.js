'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPORTS = [
  'ROUND_POINTS', 'ROUND_ORDER', 'SEED_MATCHUPS_64',
  'buildSlotIds', 'buildTeamRegionMap', 'getEliminatedTeams',
  'calculateScore', 'calculateRemainingPossible', 'scorePicks',
  'buildSeasonSnapshot', 'getPickStatus', 'buildR64Matchups', 'getTeamSeed',
];

/** Evaluate the browser script app.js unchanged and return the functions under test. */
function loadApp() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
  // new Function keeps results in this realm so assert.deepStrictEqual works on them.
  return new Function(`${source}\nreturn { ${EXPORTS.join(', ')} };`)();
}

module.exports = loadApp();
