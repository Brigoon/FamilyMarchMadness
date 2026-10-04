#!/usr/bin/env node
'use strict';

/**
 * Check or build fixtures from bracket files.
 *
 *   node tests/tools/explain.js --results results.json --picks a.json [b.json ...]
 *       [--tournament file] [--through stage[,stage...]] [--detail] [--emit]
 *
 * --results     a complete (or partial) results file. A Picks JSON copied from the sheet works too.
 * --picks       one or more Picks JSON files (the cell from the Brackets/History tab).
 * --through     stages to check, default every round: openingRound,roundOf64,roundOf32,sweetSixteen,
 *               eliteEight,finalFour,championship. Use "final" to score partial results as given.
 * --detail      print the round-by-round table for every stage shown
 * --emit        print a fixture file (to paste into tests/fixtures/manual/) with the numbers
 *               filled in. Check them against your hand count before committing them.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ROUND_ORDER, scorePicks } = require('../helpers/load-app');
const gen = require('../helpers/bracket-gen');
const { STAGES, DEFAULT_TOURNAMENT, readJSON } = require('../helpers/fixtures');

function parseArgs(argv) {
  const args = { picks: [], through: ROUND_ORDER, detail: false, emit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--results') args.results = argv[++i];
    else if (a === '--tournament') args.tournament = argv[++i];
    else if (a === '--through') args.through = argv[++i].split(',');
    else if (a === '--detail') args.detail = true;
    else if (a === '--emit') args.emit = true;
    else if (a === '--picks') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.picks.push(argv[++i]);
    } else {
      throw new Error(`Unknown argument "${a}"`);
    }
  }
  if (!args.results || args.picks.length === 0) throw new Error('--results and at least one --picks file are required');
  for (const s of args.through) if (!STAGES.includes(s)) throw new Error(`Unknown stage "${s}". Use: ${STAGES.join(', ')}`);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tournament = readJSON(args.tournament || DEFAULT_TOURNAMENT);
  const fullResults = gen.toShape(gen.winnersOf(tournament, readJSON(args.results)));

  const brackets = args.picks.map(file => {
    const picks = readJSON(file);
    return { name: picks.submitter || path.basename(file, '.json'), picks, file };
  });

  if (args.emit) {
    const fixture = {
      description: 'Describe what this fixture covers and how the numbers were verified.',
      results: fullResults,
      brackets: brackets.map(b => ({
        name: b.name,
        picks: stripSubmitter(b.picks),
        expected: Object.fromEntries(args.through.map(stage => {
          const r = gen.breakdown(tournament, b.picks, gen.throughRound(tournament, fullResults, stage));
          return [stage, { score: r.score, maxPossible: r.maxPossible }];
        })),
      })),
    };
    console.log(JSON.stringify(fixture, null, 2));
    return;
  }

  for (const b of brackets) {
    console.log(`\n=== ${b.name} (${b.file}) ===`);
    console.log('stage            engine         first principles');
    for (const stage of args.through) {
      const results = gen.throughRound(tournament, fullResults, stage);
      const engine = scorePicks({ submitter: b.name, ...b.picks }, results, tournament);
      const ref = gen.breakdown(tournament, b.picks, results);
      const same = engine.currentScore === ref.score && engine.maxPossible === ref.maxPossible;
      console.log(`${stage.padEnd(16)} ${`${engine.currentScore} / ${engine.maxPossible}`.padEnd(14)} ${ref.score} / ${ref.maxPossible}${same ? '' : '   <-- MISMATCH'}`);
      if (args.detail) console.log(`\n${gen.formatBreakdown(ref)}\n`);
    }
  }
}

function stripSubmitter(picks) {
  const { submitter, ...rest } = picks;
  return rest;
}

try {
  main();
} catch (err) {
  console.error(err.message);
  console.error('Usage: node tests/tools/explain.js --results <file> --picks <file...> [--tournament <file>] [--through stages] [--detail] [--emit]');
  process.exit(1);
}
