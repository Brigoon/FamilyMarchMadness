# Steve Madness

A static March Madness bracket submission and scoring website for a small family group. Brackets can be submitted directly from the browser using a Google Apps Script backend — no downloads or manual file management required. The site is served statically (e.g., GitHub Pages).

## Quick Start

1. Set up cloud bracket storage (see **Google Apps Script Setup** below)
2. Serve the files with any static server (or push to GitHub Pages)
3. Open `index.html` for the scoreboard
4. Open `submit.html` to fill out and submit a bracket
5. View individual brackets at `bracket.html?name=brian`

## Google Apps Script Setup

Brackets are stored in a Google Sheet through a Google Apps Script web app. The script enforces who can submit, who can edit, and when.

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Replace the contents of `Code.gs` with the code from `google-apps-script.js` in this repo
3. Run the `setup` function once and authorize it. It creates the spreadsheet (URL is in the execution log) with three tabs: `Brackets`, `Config` and `History`
4. In the spreadsheet's `Config` tab, fill in:
   - **Deadline**: ISO time with UTC offset, e.g. `2027-03-18T12:15:00-04:00`
   - **Family Passcode**: any phrase you share with the family (never commit it to the repo)
5. Click **Deploy → New deployment**, choose **Web app**, set **Execute as** to your Google account and **Who has access** to **Anyone**
6. Copy the web app URL into `config.js`:
   ```js
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
   ```
7. Commit and push

**Updating an existing deployment:** Deploy → Manage deployments → Edit (pencil) → Version: **New version** → Deploy. The URL stays the same. If you are upgrading from the old script, clear the old `Brackets` rows first (the pick format changed).

Optionally run `selfTest` in the Apps Script editor to check the validation helpers.

## How It Works

### Submitting and Editing Brackets

Participants visit `submit.html`, fill out their bracket, and enter their name, the family passcode, and a PIN.

- **Passcode:** required for every submission. Anyone without it is rejected.
- **PIN:** the first submission under a name claims it with the PIN chosen. Later edits to that name need the same PIN, so nobody else can change it. **Load My Bracket** pre-fills the form with an existing bracket.
- **Deadline:** checked on Google's server clock. After it passes, submissions are rejected.
- **Hidden picks:** until the deadline, the scoreboard shows names only. Brackets are revealed afterwards.
- Repeated wrong PINs or passcodes are temporarily blocked (15 minutes).

### Admin Overrides

You own the spreadsheet, so you can edit it directly at any time, including after the deadline.

- **Change the deadline or passcode:** edit the `Config` tab. It takes effect immediately for submissions; the scoreboard and countdown can take up to a minute to catch up because reads are cached.
- **Edit or delete a bracket:** edit or delete its row in `Brackets` (the scoreboard may take up to a minute to show it).
- **Forgotten PIN:** clear the `PinSalt` and `PinHash` cells on that row. The next submission with the passcode re-claims the name.
- **Recover an overwritten bracket:** every submission is appended to the `History` tab.

### Updating Results

After each round of games, edit `results.json` with the winners:

```json
{
  "openingRound": {
    "OR1": "East 16 Seed A",
    "OR2": "West 16 Seed A",
    "OR3": "South 16 Seed A",
    "OR4": "Midwest 16 Seed A"
  },
  "roundOf64": {
    "East_1": "East 1 Seed",
    "East_2": "East 8 Seed",
    ...
  },
  "roundOf32": { ... },
  "sweetSixteen": { ... },
  "eliteEight": { ... },
  "finalFour": { ... },
  "championship": "East 1 Seed"
}
```

- Use `null` or omit a key for games not yet played
- Team names must exactly match those in `tournament.json`
- Slot IDs follow the pattern `Region_N` (e.g., `East_1`, `West_3`)

### Slot ID Reference

| Round | Slots | Pattern |
|-------|-------|---------|
| Opening Round | 12 games | `OR1` through `OR12` |
| Round of 64 | 32 games | `Region_1` through `Region_8` per region |
| Round of 32 | 16 games | `Region_1` through `Region_4` per region |
| Sweet Sixteen | 8 games | `Region_1` and `Region_2` per region |
| Elite Eight | 4 games | `East`, `West`, `South`, `Midwest` |
| Final Four | 2 games | `FF_1` (East vs South), `FF_2` (West vs Midwest) |
| Championship | 1 game | Single string value |

### Opening Round Format (76 teams)

The field is 76 teams, with a 12-game opening round feeding the Round of 64:

- All four **16 seeds** play an opening-round game
- All four **12 seeds** play an opening-round game
- Two of the four **11 seeds** play an opening-round game
- Two of the four **15 seeds** play an opening-round game

Which regions host the 11-seed and 15-seed opening-round games isn't known until closer to Selection Sunday. `tournament.json` currently assigns these as a placeholder (West/Midwest for the 11 seed games, East/South for the 15 seed games) — edit the `openingRound` and `teams` arrays once the actual bracket is released if the regions differ.

### Seed Matchups (Round of 64)

| Slot | Seeds |
|------|-------|
| `_1` | 1 vs 16 |
| `_2` | 8 vs 9 |
| `_3` | 5 vs 12 |
| `_4` | 4 vs 13 |
| `_5` | 6 vs 11 |
| `_6` | 3 vs 14 |
| `_7` | 7 vs 10 |
| `_8` | 2 vs 15 |

## Scoring

| Round | Points per correct pick |
|-------|------------------------|
| Opening Round | 1 |
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet Sixteen | 3 |
| Elite Eight | 4 |
| Final Four | 5 |
| Championship | 6 |

**Max Possible Score** = Current Score + remaining points from games where the picked team is still alive.

## Hall of Fame

`hall-of-fame.html` lists the final leaderboard (rank, name, score) and the tournament champion for each archived season. Only these are stored, not the brackets. Tied scores share a rank, and everyone at rank 1 is highlighted as a winner.

### End of Season Checklist

1. Once `results.json` has the `championship`, open `index.html`. An **Archive this season** panel appears below the scoreboard.
2. Check the year, then click **Copy**.
3. Paste the entry into the `seasons` array in `hall-of-fame.json` (replace the entry if that year already exists) and commit.
4. Reset for next season:
   - update `tournament.json` with the new field
   - reset `results.json` to empty (`{ "openingRound": {}, "roundOf64": {}, ..., "championship": null }`)
   - set a new `Deadline` in the `Config` tab of the spreadsheet
   - delete the old rows in the `Brackets` and `History` tabs (only after archiving)

No redeploy of the Apps Script is needed.

## Testing

The scoring engine in `app.js` has a test suite that uses Node's built-in test runner (Node 20 or newer, no `npm install` needed).

```bash
npm test              # everything
npm run check-data    # only the tournament.json / results.json checks
```

It runs automatically on every push through GitHub Actions (`.github/workflows/test.yml`).

| File | What it covers |
|------|----------------|
| `tests/scoring.test.js` | Hand-worked scenarios: perfect bracket, all wrong, upset paths, Final Four pairing, ties in the Hall of Fame |
| `tests/manual-fixtures.test.js` | Every file in `tests/fixtures/manual/`, checked automatically |
| `tests/properties.test.js` | Random brackets and results checked against rules that must always hold, and against an independent calculation |
| `tests/data.test.js` | Your live `tournament.json` and `results.json` (76 teams, valid winners, no typos) |

Run `npm run check-data` after editing `results.json` to catch a misspelled team or a winner entered in the wrong game.

### Adding a hand-verified fixture

A Picks JSON from the spreadsheet has the same shape as `results.json`, so you can fill out everything on the submit page:

1. Fill out a complete bracket as a fake person (for example `RESULTS`) to act as the results. Then fill out the brackets you want to score under test names.
2. Copy each bracket's `Picks JSON` cell from the `Brackets` or `History` tab into its own file, such as `/tmp/results.json` and `/tmp/alice.json`.
3. Print a table to check by hand (the `--through` stages are `openingRound`, `roundOf64`, `roundOf32`, `sweetSixteen`, `eliteEight`, `finalFour`, `championship`, and `final`):
   ```bash
   node tests/tools/explain.js --results /tmp/results.json --picks /tmp/alice.json /tmp/bob.json --detail
   ```
4. When the numbers match your hand count, write the fixture file:
   ```bash
   node tests/tools/explain.js --results /tmp/results.json --picks /tmp/alice.json /tmp/bob.json --emit > tests/fixtures/manual/my-test.json
   ```
   Remove any stages you did not verify from `expected`, and fill in `description`. The numbers are produced by the code, so only commit them after checking them yourself.

A fixture looks like this: `results` is a full set of results, and each bracket lists the `score` and `maxPossible` expected after each round. `final` means the results exactly as given.

```json
{
  "description": "What this covers",
  "results": { "openingRound": {}, "...": {}, "championship": "Team" },
  "brackets": [
    {
      "name": "Alice",
      "picks": { "openingRound": {}, "...": {}, "championship": "Team" },
      "expected": { "roundOf32": { "score": 73, "maxPossible": 111 }, "championship": { "score": 111, "maxPossible": 111 } }
    }
  ]
}
```

Fixtures use their own copy of the field (`tests/fixtures/tournament-76.json`), so they keep working when `tournament.json` changes for a new season. Use test names rather than real family brackets, because this folder is published with the site.

## Deploying to GitHub Pages

1. Push all files to a GitHub repository
2. Go to **Settings → Pages**
3. Set source to your branch (e.g., `main`) and folder (`/ (root)`)
4. Your site will be live at `https://yourusername.github.io/your-repo/`

The scoreboard auto-refreshes every 60 seconds, so updating `results.json` and pushing will update the live site.

## File Structure

```
/
├── index.html              # Scoreboard
├── bracket.html            # Individual bracket view
├── submit.html             # Bracket submission form
├── hall-of-fame.html       # Past seasons' final leaderboards
├── styles.css              # Shared styles
├── app.js                  # Scoring engine & data utilities
├── config.js               # Apps Script URL configuration
├── google-apps-script.js   # Code to paste into Google Apps Script
├── tournament.json         # Tournament field definition
├── results.json            # Game results (manually updated)
├── hall-of-fame.json       # Archived season leaderboards (manually updated)
├── package.json            # Test scripts only (no dependencies)
├── tests/                  # Scoring test suite (see Testing)
├── .github/workflows/      # Runs the tests on every push
└── README.md
```

## Tech Stack

- Vanilla HTML, CSS, JavaScript — no build step, no frameworks, no CDN dependencies
- Optional Google Apps Script backend for cloud bracket storage (free, no additional accounts needed)
- All data loaded via `fetch()` from relative paths or Apps Script endpoint
- Works on GitHub Pages or any static file server
