# Micro Mayhem

Tiny games. Total chaos. A WarioWare-style run of 33 touch microgames for iPhone, a few seconds each, speeding up every 5 games.

The game is a single web page (`www/index.html`) inside a native iOS shell built with [Capacitor](https://capacitorjs.com). GitHub Actions builds it on a Mac runner and uploads it to TestFlight, so nothing needs installing locally.

## What's in here

| Path | What it is |
| --- | --- |
| `www/` | The game: HTML, canvas drawing, synthesised audio, Fredoka fonts |
| `ios/App/` | The Xcode project |
| `ios/App/App/GameCenter.swift` | Game Center plugin, plus full-screen portrait settings |
| `capacitor.config.json` | App id, name and background colour |
| `store/setup.json` | Bundle ID and leaderboard details used by the setup workflow |
| `scripts/setup-store.mjs` | Registers the bundle ID and creates the Game Center leaderboard |
| `.github/workflows/setup-store.yml` | **Set up App Store Connect** (run by hand) |
| `.github/workflows/testflight.yml` | **Build and upload to TestFlight** (run by hand) |
| `.github/workflows/store-listing.yml` | **Update App Store listing**: text, category, screenshots from `store/` |
| `.github/workflows/create-achievements.yml` | **Create Game Center achievements** from `store/achievements.json` |

## App settings

- **Bundle ID:** `com.bishimitsu.micromayhem`
- **Name:** Micro Mayhem
- **Devices:** iPhone only, portrait only
- **Minimum iOS:** 15
- **Capabilities:** Game Center (one leaderboard: `micromayhem.highscore`, best score, high to low; 8 achievements, 300 points, listed in `store/achievements.json`)

## Repository secrets

`ASC_ISSUER_ID`, `ASC_KEY_ID` and `ASC_PRIVATE_KEY` (the full contents of the App Store Connect API `.p8` file). The same key Colour Connect uses works here.

## First release

1. Run **Set up App Store Connect**. It registers the bundle ID with Game Center.
2. In App Store Connect, create the app: Apps > + > New App, iOS, name "Micro Mayhem", bundle ID `com.bishimitsu.micromayhem`.
3. Run **Set up App Store Connect** again. It turns on Game Center for the app and creates the leaderboard.
4. Run **Build and upload to TestFlight**. The build appears in TestFlight after Apple processes it.

## Changing the game

Edit `www/index.html`, commit and push, then run **Build and upload to TestFlight**.

The Tester screen is hidden in the app: tap the Micro Mayhem logo 5 times quickly to open it.
