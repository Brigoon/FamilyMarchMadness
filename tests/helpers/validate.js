'use strict';

const { buildGames, resolve } = require('./bracket-gen');

const ROUND_KEYS = ['openingRound', 'roundOf64', 'roundOf32', 'sweetSixteen', 'eliteEight', 'finalFour', 'championship'];

/** Returns a list of human-readable problems (empty list = valid). */
function validateTournament(t, expected) {
  const problems = [];
  const regions = Array.isArray(t.regions) ? t.regions : [];
  if (regions.length !== 4 || new Set(regions).size !== 4) problems.push('"regions" must list 4 distinct regions');
  if (!Array.isArray(t.teams) || !Array.isArray(t.openingRound)) return [...problems, '"teams" and "openingRound" must both be arrays'];

  if (t.openingRound.length !== expected.openingGames) {
    problems.push(`expected ${expected.openingGames} opening-round games, found ${t.openingRound.length}`);
  }

  const names = new Map();
  const noteName = (name, where) => {
    if (typeof name !== 'string' || !name.trim()) problems.push(`${where}: team name is empty`);
    else if (names.has(name)) problems.push(`duplicate team name "${name}" (${names.get(name)} and ${where})`);
    else names.set(name, where);
  };

  const filled = new Map(); // "region/seed" -> description
  const fill = (region, seed, where) => {
    if (!regions.includes(region)) problems.push(`${where}: unknown region "${region}"`);
    if (!Number.isInteger(seed) || seed < 1 || seed > 16) problems.push(`${where}: seed must be 1-16`);
    const k = `${region}/${seed}`;
    if (filled.has(k)) problems.push(`${region} seed ${seed} is filled twice (${filled.get(k)} and ${where})`);
    else filled.set(k, where);
  };

  const ids = new Set();
  for (const g of t.openingRound) {
    if (ids.has(g.id)) problems.push(`duplicate opening-round id "${g.id}"`);
    ids.add(g.id);
    if (!Array.isArray(g.teams) || g.teams.length !== 2) { problems.push(`${g.id}: needs exactly 2 teams`); continue; }
    const [a, b] = g.teams;
    if (a.seed !== b.seed || a.region !== b.region) problems.push(`${g.id}: both teams must share a seed and region`);
    noteName(a.name, g.id);
    noteName(b.name, g.id);
    fill(a.region, a.seed, g.id);
  }
  for (const team of t.teams) {
    noteName(team.name, `${team.region} ${team.seed}`);
    fill(team.region, team.seed, team.name);
  }

  const total = t.teams.length + 2 * t.openingRound.length;
  if (total !== expected.teams) problems.push(`expected ${expected.teams} teams, found ${total}`);

  for (const r of regions) {
    for (let s = 1; s <= 16; s++) if (!filled.has(`${r}/${s}`)) problems.push(`${r} is missing seed ${s}`);
  }
  return problems;
}

/** Returns problems with a results object: unknown slots, misspelled winners, results out of order. */
function validateResults(t, results) {
  const problems = [];
  const games = buildGames(t);
  const valid = new Set(games.map(g => g.key));

  for (const round of Object.keys(results)) {
    if (!ROUND_KEYS.includes(round)) problems.push(`unknown round "${round}"`);
  }
  for (const round of ROUND_KEYS.filter(r => r !== 'championship')) {
    for (const slot of Object.keys(results[round] || {})) {
      if (!valid.has(`${round}|${slot}`)) problems.push(`${round}: unknown slot "${slot}"`);
    }
  }

  const winners = {};
  for (const g of games) {
    const v = g.round === 'championship' ? results.championship : (results[g.round] || {})[g.slot];
    if (v != null && v !== '') winners[g.key] = v;
  }

  for (const g of games) {
    const w = winners[g.key];
    if (w == null) continue;
    const a = resolve(g.a, winners);
    const b = resolve(g.b, winners);
    const label = g.round === 'championship' ? 'championship' : `${g.round} ${g.slot}`;
    if (a == null || b == null) {
      problems.push(`${label}: has a winner ("${w}") but an earlier game feeding it is not decided`);
    } else if (w !== a && w !== b) {
      problems.push(`${label}: "${w}" did not play in this game (it is "${a}" vs "${b}")`);
    }
  }
  return problems;
}

module.exports = { validateTournament, validateResults };
