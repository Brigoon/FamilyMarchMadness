# March Madness Bracket

A static March Madness bracket submission and scoring website for a small family group. No backend or authentication — all data is managed via local JSON config files and the site is served statically (e.g., GitHub Pages).

## Quick Start

1. Serve the files with any static server (or push to GitHub Pages)
2. Open `index.html` for the scoreboard
3. Open `submit.html` to fill out a bracket
4. View individual brackets at `bracket.html?name=brian`

## How It Works

### Adding a New Participant

1. Have them fill out their bracket at `submit.html` and download the `.json` file
2. Place the downloaded file in the `picks/` folder
3. Add the filename to `picks/manifest.json`:
   ```json
   {
     "participants": ["example.json", "brian.json", "sarah.json"]
   }
   ```
4. Commit and push (if using GitHub Pages)

### Updating Results

After each round of games, edit `results.json` with the winners:

```json
{
  "firstFour": {
    "FF1": "Texas Southern",
    "FF2": "SE Missouri St",
    "FF3": "Nevada",
    "FF4": "Boise St"
  },
  "roundOf64": {
    "East_1": "Duke",
    "East_2": "Alabama",
    ...
  },
  "roundOf32": { ... },
  "sweetSixteen": { ... },
  "eliteEight": { ... },
  "finalFour": { ... },
  "championship": "Duke"
}
```

- Use `null` or omit a key for games not yet played
- Team names must exactly match those in `tournament.json`
- Slot IDs follow the pattern `Region_N` (e.g., `East_1`, `West_3`)

### Slot ID Reference

| Round | Slots | Pattern |
|-------|-------|---------|
| First Four | 4 games | `FF1`, `FF2`, `FF3`, `FF4` |
| Round of 64 | 32 games | `Region_1` through `Region_8` per region |
| Round of 32 | 16 games | `Region_1` through `Region_4` per region |
| Sweet Sixteen | 8 games | `Region_1` and `Region_2` per region |
| Elite Eight | 4 games | `East`, `West`, `South`, `Midwest` |
| Final Four | 2 games | `FF_1` (East vs South), `FF_2` (West vs Midwest) |
| Championship | 1 game | Single string value |

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
| First Four | 1 |
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet Sixteen | 3 |
| Elite Eight | 4 |
| Final Four | 5 |
| Championship | 6 |

**Max Possible Score** = Current Score + remaining points from games where the picked team is still alive.

## Deploying to GitHub Pages

1. Push all files to a GitHub repository
2. Go to **Settings → Pages**
3. Set source to your branch (e.g., `main`) and folder (`/ (root)`)
4. Your site will be live at `https://yourusername.github.io/your-repo/`

The scoreboard auto-refreshes every 60 seconds, so updating `results.json` and pushing will update the live site.

## File Structure

```
/
├── index.html          # Scoreboard
├── bracket.html        # Individual bracket view
├── submit.html         # Bracket submission form
├── styles.css          # Shared styles
├── app.js              # Scoring engine & data utilities
├── tournament.json     # Tournament field definition
├── results.json        # Game results (manually updated)
├── README.md
└── picks/
    ├── manifest.json   # List of participant filenames
    └── example.json    # Example picks file
```

## Tech Stack

- Vanilla HTML, CSS, JavaScript — no build step, no frameworks, no CDN dependencies
- All data loaded via `fetch()` from relative paths
- Works on GitHub Pages or any static file server
