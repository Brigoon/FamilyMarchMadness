/**
 * app.js — Shared utilities for March Madness Bracket
 *
 * Contains: data loading, scoring engine, max-possible-point calculations,
 *           bracket structure helpers, and common constants.
 */

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/**
 * Point values per round.
 *   First Four play-in games:  1 pt each
 *   Round of 64:               1 pt each
 *   Round of 32:               2 pts each
 *   Sweet Sixteen:             3 pts each
 *   Elite Eight:               4 pts each
 *   Final Four:                5 pts each
 *   Championship:              6 pts
 */
const ROUND_POINTS = {
  firstFour:     1,
  roundOf64:     1,
  roundOf32:     2,
  sweetSixteen:  3,
  eliteEight:    4,
  finalFour:     5,
  championship:  6,
};

/** Ordered list of round keys (earliest → latest). */
const ROUND_ORDER = [
  'firstFour',
  'roundOf64',
  'roundOf32',
  'sweetSixteen',
  'eliteEight',
  'finalFour',
  'championship',
];

/** Human-readable round labels. */
const ROUND_LABELS = {
  firstFour:     'First Four',
  roundOf64:     'Round of 64',
  roundOf32:     'Round of 32',
  sweetSixteen:  'Sweet Sixteen',
  eliteEight:    'Elite Eight',
  finalFour:     'Final Four',
  championship:  'Championship',
};

// ─── DATA LOADING ────────────────────────────────────────────────────────────

/** Fetch JSON from a relative path; returns parsed object. */
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

/** Load tournament.json */
async function loadTournament() {
  return fetchJSON('tournament.json');
}

/** Load results.json */
async function loadResults() {
  return fetchJSON('results.json');
}

/** Load all picks from Google Apps Script. */
async function loadAllPicks() {
  const res = await fetch(APPS_SCRIPT_URL);
  if (!res.ok) throw new Error(`Failed to fetch picks: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

// ─── BRACKET STRUCTURE HELPERS ───────────────────────────────────────────────

/**
 * Standard NCAA bracket seed matchups for the Round of 64 (after First Four).
 * Each entry is [topSeed, bottomSeed] — seeds that play each other.
 * The matchup index (1-8) is used as the slot suffix: Region_1 through Region_8.
 */
const SEED_MATCHUPS_64 = [
  [1, 16],
  [8,  9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

/**
 * Build all game slot IDs for the entire tournament.
 * Returns an object keyed by round name → array of slot IDs.
 */
function buildSlotIds(regions) {
  const slots = {};

  // First Four: FF1..FF4
  slots.firstFour = ['FF1', 'FF2', 'FF3', 'FF4'];

  // Round of 64: Region_1..Region_8 for each region (8 games per region = 32 total)
  slots.roundOf64 = [];
  for (const r of regions) {
    for (let i = 1; i <= 8; i++) slots.roundOf64.push(`${r}_${i}`);
  }

  // Round of 32: Region_1..Region_4 (4 games per region = 16 total)
  slots.roundOf32 = [];
  for (const r of regions) {
    for (let i = 1; i <= 4; i++) slots.roundOf32.push(`${r}_${i}`);
  }

  // Sweet Sixteen: Region_1..Region_2 (2 games per region = 8 total)
  slots.sweetSixteen = [];
  for (const r of regions) {
    for (let i = 1; i <= 2; i++) slots.sweetSixteen.push(`${r}_${i}`);
  }

  // Elite Eight: one game per region (Region name as id)
  slots.eliteEight = regions.map(r => r);

  // Final Four: two games
  // FF_1 = East winner vs South winner; FF_2 = West winner vs Midwest winner
  slots.finalFour = ['FF_1', 'FF_2'];

  // Championship: single slot (we treat it as a string value, not keyed)
  slots.championship = ['championship'];

  return slots;
}

/**
 * Given the tournament data, build a lookup of team → region.
 */
function buildTeamRegionMap(tournament) {
  const map = {};
  for (const t of tournament.teams) {
    map[t.name] = t.region;
  }
  // First Four teams also need mapping
  for (const ff of tournament.firstFour) {
    for (const t of ff.teams) {
      map[t.name] = t.region;
    }
  }
  return map;
}

// ─── ELIMINATED TEAMS ────────────────────────────────────────────────────────

/**
 * Determine which teams have been eliminated based on results.
 *
 * A team is eliminated if it was in a game slot (i.e., it was one of the two
 * participants) and the result for that slot is a DIFFERENT team.
 *
 * We build eliminated set by scanning all resolved results: for each slot with
 * a confirmed winner, every team that could have been in that slot but is NOT
 * the winner is eliminated.
 *
 * Simpler approach: we scan results round-by-round. A team is eliminated if
 * results show it lost — i.e., the result for a slot is set and the team was
 * one of the two options but was not chosen. We infer participants from
 * tournament structure and prior round results.
 *
 * For a static site without complex bracket back-referencing, we use a
 * simpler heuristic: a team is eliminated if it appears as a pick somewhere
 * but the result for that slot is a *different* team. More precisely, we check
 * every result entry — the loser of each decided game is eliminated.
 *
 * Practical approach: scan all results. For every resolved slot, the winner
 * survives; the opponent is eliminated. We determine opponents from bracket
 * structure. However, the simplest correct method is:
 *
 *   A team is eliminated if there exists a round R and slot S such that:
 *     - results[R][S] is set (non-null)
 *     - The team was a participant in that game (was a potential entrant)
 *     - The team is NOT the winner
 *
 * Since determining "participant in that game" requires bracket reconstruction,
 * we instead use the even simpler rule:
 *
 *   A team is still alive if either:
 *     (a) It has won its most-recently-played game (appears as a result value), OR
 *     (b) It has not yet played any game with a result.
 *
 *   Conversely, a team is eliminated if it has appeared in at least one game
 *   slot where a result exists, and it did NOT win that game, and it did NOT
 *   win any later game.
 *
 * The simplest correct implementation: a team is alive if it appears as a
 * winner in results at the latest round it has a result for, or it has no
 * results yet. We track the "latest round" each team appears in as a winner.
 * A team is eliminated if it once won a game but did NOT win its next game
 * (i.e., a result exists in a later round for the slot that team would occupy,
 * and a different team won).
 *
 * FINAL PRACTICAL APPROACH — used below:
 *   Build the set of all winners from results. A team is eliminated if:
 *     - It is NOT in the set of winners for its latest possible round, AND
 *     - A result exists for the slot where that team would next play.
 *
 *   Even simpler: build a set of "latest winners" per region bracket path.
 *   Actually, the simplest correct thing: gather all teams that have LOST.
 *   For each decided slot, we know the winner. We need to know the two
 *   participants. Rather than reconstructing full bracket pairings, we use:
 *
 *   getEliminatedTeams(results, tournament):
 *     1. Build set of all teams
 *     2. Build set of all winners across all rounds
 *     3. For each team, check if there is a resolved game where the team
 *        SHOULD have been playing (based on bracket position) but is not the
 *        winner. If so, eliminated.
 *
 *   For simplicity, we implement it round by round, tracking which teams
 *   advance.
 */
function getEliminatedTeams(results, tournament) {
  const eliminated = new Set();
  const regions = tournament.regions;

  // ── First Four ──
  for (const ff of tournament.firstFour) {
    const winner = results.firstFour && results.firstFour[ff.id];
    if (winner) {
      for (const t of ff.teams) {
        if (t.name !== winner) eliminated.add(t.name);
      }
    }
  }

  // Helper: get team by seed and region from tournament.teams + firstFour winners
  function getTeamForSeed(region, seed) {
    // Check if this seed slot is filled by a First Four winner
    const ffGame = tournament.firstFour.find(ff =>
      ff.teams[0].seed === seed && ff.teams[0].region === region
    );
    if (ffGame) {
      const w = results.firstFour && results.firstFour[ffGame.id];
      return w || null; // null if First Four not yet played
    }
    const t = tournament.teams.find(t => t.region === region && t.seed === seed);
    return t ? t.name : null;
  }

  // ── Round of 64 ──
  // Build the 8 matchups per region
  for (const region of regions) {
    for (let i = 0; i < SEED_MATCHUPS_64.length; i++) {
      const [seedA, seedB] = SEED_MATCHUPS_64[i];
      const slotId = `${region}_${i + 1}`;
      const winner = results.roundOf64 && results.roundOf64[slotId];
      if (winner) {
        const teamA = getTeamForSeed(region, seedA);
        const teamB = getTeamForSeed(region, seedB);
        if (teamA && teamA !== winner) eliminated.add(teamA);
        if (teamB && teamB !== winner) eliminated.add(teamB);
      }
    }
  }

  // ── Round of 32 ──
  // Matchup i in R32 is winner of R64 slot 2i-1 vs winner of R64 slot 2i
  for (const region of regions) {
    for (let i = 1; i <= 4; i++) {
      const slotId = `${region}_${i}`;
      const winner = results.roundOf32 && results.roundOf32[slotId];
      if (winner) {
        const teamA = results.roundOf64 && results.roundOf64[`${region}_${2 * i - 1}`];
        const teamB = results.roundOf64 && results.roundOf64[`${region}_${2 * i}`];
        if (teamA && teamA !== winner) eliminated.add(teamA);
        if (teamB && teamB !== winner) eliminated.add(teamB);
      }
    }
  }

  // ── Sweet Sixteen ──
  for (const region of regions) {
    for (let i = 1; i <= 2; i++) {
      const slotId = `${region}_${i}`;
      const winner = results.sweetSixteen && results.sweetSixteen[slotId];
      if (winner) {
        const teamA = results.roundOf32 && results.roundOf32[`${region}_${2 * i - 1}`];
        const teamB = results.roundOf32 && results.roundOf32[`${region}_${2 * i}`];
        if (teamA && teamA !== winner) eliminated.add(teamA);
        if (teamB && teamB !== winner) eliminated.add(teamB);
      }
    }
  }

  // ── Elite Eight ──
  for (const region of regions) {
    const winner = results.eliteEight && results.eliteEight[region];
    if (winner) {
      const teamA = results.sweetSixteen && results.sweetSixteen[`${region}_1`];
      const teamB = results.sweetSixteen && results.sweetSixteen[`${region}_2`];
      if (teamA && teamA !== winner) eliminated.add(teamA);
      if (teamB && teamB !== winner) eliminated.add(teamB);
    }
  }

  // ── Final Four ──
  // FF_1 = East vs South, FF_2 = West vs Midwest
  const ffPairs = [
    ['FF_1', [regions[0], regions[2]]],
    ['FF_2', [regions[1], regions[3]]],
  ];
  for (const [slotId, [r1, r2]] of ffPairs) {
    const winner = results.finalFour && results.finalFour[slotId];
    if (winner) {
      const teamA = results.eliteEight && results.eliteEight[r1];
      const teamB = results.eliteEight && results.eliteEight[r2];
      if (teamA && teamA !== winner) eliminated.add(teamA);
      if (teamB && teamB !== winner) eliminated.add(teamB);
    }
  }

  // ── Championship ──
  if (results.championship) {
    const teamA = results.finalFour && results.finalFour['FF_1'];
    const teamB = results.finalFour && results.finalFour['FF_2'];
    if (teamA && teamA !== results.championship) eliminated.add(teamA);
    if (teamB && teamB !== results.championship) eliminated.add(teamB);
  }

  return eliminated;
}

// ─── SCORING ENGINE ──────────────────────────────────────────────────────────

/**
 * Calculate current score for a participant's picks against results.
 *
 * Logic:
 *   For each round, iterate over every slot:
 *     - If results[round][slot] is set AND picks[round][slot] matches → award points
 *     - Otherwise → no points for that slot
 *
 *   Championship is a special case (single string, not an object).
 *
 * @param {Object} picks     – participant's pick data
 * @param {Object} results   – results data
 * @param {Set}    eliminated – set of eliminated team names
 * @returns {number} current score
 */
function calculateScore(picks, results, eliminated) {
  let score = 0;

  for (const round of ROUND_ORDER) {
    const pts = ROUND_POINTS[round];

    if (round === 'championship') {
      // Championship is a single value
      if (results.championship && picks.championship === results.championship) {
        score += pts;
      }
      continue;
    }

    const pickRound = picks[round] || {};
    const resultRound = results[round] || {};

    for (const slot of Object.keys(resultRound)) {
      const resultVal = resultRound[slot];
      if (resultVal != null && pickRound[slot] === resultVal) {
        score += pts;
      }
    }
  }

  return score;
}

/**
 * Calculate remaining possible points a participant can still earn.
 *
 * For each round and each slot:
 *   - If the result already exists:
 *       → Already scored (or not) — no remaining points from this slot.
 *   - If the result does NOT exist (game not yet played):
 *       → If the participant's pick for this slot is a team that is
 *         still alive (not eliminated), the full round points count.
 *       → If the picked team is already eliminated, 0 remaining points
 *         from this slot (impossible for the pick to be correct).
 *
 * @param {Object} picks      – participant's pick data
 * @param {Object} results    – results data
 * @param {Set}    eliminated  – set of eliminated team names
 * @param {string[]} regions  – region names
 * @returns {number} remaining possible points
 */
function calculateRemainingPossible(picks, results, eliminated, regions) {
  let remaining = 0;
  const slots = buildSlotIds(regions);

  for (const round of ROUND_ORDER) {
    const pts = ROUND_POINTS[round];

    if (round === 'championship') {
      // Championship: single value
      if (results.championship == null) {
        // Game not yet played
        if (picks.championship && !eliminated.has(picks.championship)) {
          remaining += pts;
        }
      }
      continue;
    }

    const pickRound = picks[round] || {};
    const resultRound = results[round] || {};
    const roundSlots = slots[round];

    for (const slot of roundSlots) {
      if (resultRound[slot] != null) {
        // Result already exists — already counted in current score
        continue;
      }
      // No result yet: check if the picked team is still alive
      const pickedTeam = pickRound[slot];
      if (pickedTeam && !eliminated.has(pickedTeam)) {
        remaining += pts;
      }
    }
  }

  return remaining;
}

/**
 * Full scoring summary for one participant.
 *
 * @returns {{ name, currentScore, maxPossible }}
 */
function scorePicks(picks, results, tournament) {
  const eliminated = getEliminatedTeams(results, tournament);
  const current = calculateScore(picks, results, eliminated);
  const remaining = calculateRemainingPossible(picks, results, eliminated, tournament.regions);
  return {
    name: picks.submitter,
    currentScore: current,
    maxPossible: current + remaining,
  };
}

// ─── PICK STATUS (for bracket detail) ────────────────────────────────────────

/**
 * Determine the display status of a single pick.
 *
 * @param {string} round     – round key (e.g., 'roundOf64')
 * @param {string} slot      – slot id (e.g., 'East_1')
 * @param {string} pickValue – team the participant picked
 * @param {Object} results   – full results object
 * @param {Set}    eliminated – eliminated teams set
 * @returns {'correct'|'incorrect'|'pending'}
 */
function getPickStatus(round, slot, pickValue, results, eliminated) {
  if (!pickValue) return 'pending';

  let resultValue;
  if (round === 'championship') {
    resultValue = results.championship;
  } else {
    resultValue = results[round] && results[round][slot];
  }

  if (resultValue != null) {
    // Result is in — did the pick match?
    return pickValue === resultValue ? 'correct' : 'incorrect';
  }

  // Result not yet in — is the picked team already eliminated?
  // Treated the same as incorrect (red) since the pick can no longer come true
  if (eliminated.has(pickValue)) return 'incorrect';

  return 'pending';
}

// ─── BRACKET MATCHUP HELPERS ─────────────────────────────────────────────────

/**
 * Build the initial Round of 64 matchups for a given region.
 * Returns an array of 8 objects: { slot, teamA, seedA, teamB, seedB }
 */
function buildR64Matchups(region, tournament, results) {
  const matchups = [];

  function getTeamForSeed(region, seed) {
    const ffGame = tournament.firstFour.find(ff =>
      ff.teams[0].seed === seed && ff.teams[0].region === region
    );
    if (ffGame) {
      const w = results.firstFour && results.firstFour[ffGame.id];
      return { name: w || `Winner of ${ffGame.id}`, seed };
    }
    const t = tournament.teams.find(t => t.region === region && t.seed === seed);
    return t ? { name: t.name, seed: t.seed } : { name: 'TBD', seed };
  }

  for (let i = 0; i < SEED_MATCHUPS_64.length; i++) {
    const [seedA, seedB] = SEED_MATCHUPS_64[i];
    const slot = `${region}_${i + 1}`;
    const teamA = getTeamForSeed(region, seedA);
    const teamB = getTeamForSeed(region, seedB);
    matchups.push({
      slot,
      teamA: teamA.name,
      seedA: teamA.seed,
      teamB: teamB.name,
      seedB: teamB.seed,
    });
  }

  return matchups;
}

/**
 * Get team seed from tournament data.
 */
function getTeamSeed(teamName, tournament) {
  const t = tournament.teams.find(t => t.name === teamName);
  if (t) return t.seed;
  for (const ff of tournament.firstFour) {
    for (const tm of ff.teams) {
      if (tm.name === teamName) return tm.seed;
    }
  }
  return '?';
}
