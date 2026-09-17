# Candle Up Signal: Session Notes

**Date:** 17 Sep 2026  
**Goal:** A Binance **spot** scanner that checks every USDT pair with **1M+ USDT 24h volume** on the **15m chart**. It looks for the candle pattern marked on the user's screenshot, ranks matching coins at the top of a browser dashboard, and is also packaged as an Android app.

---

## 1. Files in this folder

| File | What it is |
|---|---|
| `index.html` | The dashboard. Open it in a browser (double-click, or `google-chrome index.html`). |
| `scanner.js` | Pattern detector plus Binance data loading. The same file runs in the browser and in Node. |
| `CandleUpSignal.apk` | Android app, built from the files above. Copy it to a phone and install. |
| `CandleUpSignal.apk.idsig` | Signature helper file created by `apksigner`. Not needed on the phone. |
| `android-app/` | Android project: `AndroidManifest.xml`, `src/.../MainActivity.java`, `res/`, `build.sh`, `release.keystore`. |
| `SESSION_NOTES.md` | This file. |

No API key is needed. Only public Binance market data is used:
- `https://data-api.binance.vision` (primary)
- `https://api.binance.com` (fallback)

---

## 2. How the pattern definition evolved

The user corrected the pattern twice during the session, so it was defined three times.

| # | Reference screenshot | What was built | User feedback |
|---|---|---|---|
| 1 | ZECUSDT 15m, https://prnt.sc/4jn1v2z9CgkO | Quiet sideways base followed by a breakout. The base could be anywhere in the last ~9 hours. | "This software is finding the middle of the chart, but I need end of the chart" |
| 2 | ASTRUSDT 15m, https://prnt.sc/TGhXu-F6TsNj | Dip, then a run of green candles, then MA7 crossing above MA25, with a volume spike at the last candle. | "No, not like that. I need this type of chart signal that the first image describes, but at the end of the chart" |
| 3 | **ZECUSDT pattern (image 1), positioned at the right edge** | **Current version** (see section 3) | — |

**Final understanding:** the pattern is the one from image 1, the red box on ZECUSDT. The latest candles on the chart must form that box: a tight, quiet, sideways base with MA7 and MA25 flat and tangled together. At the very right edge, price just starts lifting out of it. A coin whose breakout already happened, or whose box sits in the middle of the chart, should **not** rank at the top.

---

## 3. Current detection logic (`scanner.js` → `analyze()`)

### Windows

Settings live in `CFG`:
- `box = 28` candles (7h): the base, **ending at the newest closed candle**.
- `edge = 3`: the newest 3 candles of the box, where the first push shows up.
- `ref = 96` candles (24h) before the box: the baseline for "normal" candle size and volume.
- The **core box** is the box without the edge candles. It's used for box high, box low and flatness.

### Score = base quality (max 60) + first push (max 40), scaled by a "late" factor

**Base quality (60)**

| Points | Measure | Meaning |
|---|---|---|
| 18 | Compression | Average candle range in the box ÷ the 24h before it. Smaller candles score higher. |
| 16 | Tightness | Box height measured in normal candle ranges. |
| 9 | Flatness | Net drift across the box is small compared with its height. |
| 8 | MA tangle | MA7 and MA25 stay close together inside the box. |
| 4 | MA25 flat | Little MA25 slope across the box. |
| 5 | Quiet volume | Box volume is low compared with the previous 24h. |

**First push (40)**
- 10: last close is above MA7 **and** MA25.
- 8: MA7 is above MA25 (full points if it crossed in the last 10 candles).
- 7: green candles among the newest 3.
- 7: price position in the box (0 = low, 1 = high, above 1 = over the top).
- 5: volume of the newest 3 candles vs the box average.
- 3: MA25 is rising.

The push score is multiplied by `0.3 + 0.7 × base/60`, because a push out of a weak base is noise.

**Late factor:** if price is more than 2 normal candle ranges above the box top, the score is reduced (down to ×0.3).

### Stages (ranking order on the dashboard)

1. **SIGNAL**: base ≥ 38, score ≥ 68, price above MA7 and MA25, MA7 above MA25 (or just crossed), ≥ 2 green of the last 3, price in the top 20% of the box or above it, push volume ≥ 0.9× the box.
2. **FORMING**: base ≥ 36, score ≥ 58, price above both MAs, price in the upper 40% of the box.
3. **IN BASE**: base ≥ 40, no push yet. This is the watchlist.
4. **LATE**: price more than 4 normal candle ranges above the box top.
5. none

Within a stage, coins are sorted by score.

### Universe filters (`loadUniverse`)
- `quoteAsset = USDT`, status `TRADING`, spot permission, 24h `quoteVolume` ≥ the minimum (default 1,000,000).
- Excluded:
  - stablecoins and pegged assets (USDC, FDUSD, TUSD, DAI, EUR, PAXG, XAUT…)
  - leveraged UP/DOWN/BULL/BEAR tokens
- **Tokenized stocks are hidden by default** (NVDAB, TSLAB, SPYB… 77 pairs). All of them carry the Binance permission group `TRD_GRP_261`. They go flat whenever the US market is closed, which fakes a "quiet base". The dashboard has a "Hide stock tokens" toggle.

### Data
- Klines: `/api/v3/klines?interval=15m&limit=200`, with 8 requests in parallel.
- A full scan of ~140–160 pairs takes about 5 seconds and is far below Binance rate limits.
- By default only **closed** candles are judged. Unticking "Closed candles only" includes the candle still forming and rescans every minute.

---

## 4. Verification done

### Backtest on the user's own chart (ZECUSDT, 16 Sep 2026, times UTC+6)

| Time | Score | Stage |
|---|---|---|
| 08:00 | 36 | none (box not formed yet) |
| 09:00 | 55 | none |
| 09:30 | 68 | **SIGNAL** |
| 10:00 | 73 | **SIGNAL** |
| 10:45 | 73 | **SIGNAL** (right edge of the red box) |
| 11:30 | 63 | FORMING (leaving the box) |
| 13:00 | 55 | none (rally already out of the box) |

### Live scan (17 Sep 2026, ~14:30 UTC+6, stocks hidden)
- 138 pairs scanned: 5 SIGNAL, 29 FORMING, 60 IN BASE.
- Top SIGNALs: TAO, AVAX, ENA, CHIP, ADA.

### Other checks
- Rendered in headless Chrome at desktop size and phone size with no JS errors. The chart (TradingView lightweight-charts 4.2.0) draws the box at the right edge.

### Earlier versions, for reference only (replaced)
- **v1** fired on ZECUSDT at 10:30–12:00 with score 67–77.
- **v2 (ASTRUSDT dip/cross)** fired SIGNAL at 14:00–14:15 with score 67–80. That test showed the ASTR chart logic worked, but it was not the pattern the user wanted.

---

## 5. Dashboard features (`index.html`)
- **Controls:**
  - Min 24h volume
  - Auto-scan (every 15m candle close, +5s)
  - Closed candles only
  - Hide stock tokens
  - Search
  - Filters: Signals / Signal / Forming / In base / All pairs
- **Tiles:** pairs scanned, count per stage, countdown to the next scan.
- **Table:**
  - Pair (links to the Binance trade page), stage badge, NEW badge, score bar, price, 24h %, 24h volume
  - Box height, candle size vs 24h, position in the box, MA7/MA25, push volume
  - Mini chart of the last 40 candles with the **red box**
  - Click a column header to sort.
- **Row click:** full 15m chart with MA7 (yellow), MA25 (purple), volume, the red box drawn over its candles, "box start" and stage markers, stats, and the box low as a stop-loss idea.
- **Alerts (🔔):** sound plus a browser notification, or an Android notification in the app, when a coin newly becomes SIGNAL.
- **Mobile layout:** under 640px wide, less important columns are hidden. The Android back button closes the chart first.

---

## 6. Android app

### Build
- Uses the plain Android SDK tools, **no Gradle**:
  - SDK: `~/Android/Sdk`, build-tools 36.0.0, platform android-36
  - Java 21
- Command: `android-app/build.sh`.
- Steps inside the script:
  1. Copies `index.html` and `scanner.js` into the assets, and bundles lightweight-charts locally (cached in `android-app/cache/`).
  2. Runs `aapt2`, `javac`, `d8`, `zipalign`, then `apksigner`.
  3. Writes `CandleUpSignal.apk` to the project root.
- **Re-run `build.sh` after any change to `index.html` or `scanner.js`.**

### App details
- Package `com.candleup.signal`, version 1.0, minSdk 26 (Android 8.0), targetSdk 36.
- `MainActivity`:
  - Full-screen WebView loading `file:///android_asset/index.html`.
  - External links open in the Binance app or browser.
  - JS bridge `window.AndroidBridge` with `notify(title, body)` and `requestNotificationPermission()`.
  - Notification channel "Trading signals".
  - Keeps the screen on while the app is open.
- Permissions: INTERNET, POST_NOTIFICATIONS, WAKE_LOCK.
- Launcher icon: adaptive vector (red box, candles, green breakout candle, arrow).

### Signing key
- File: `android-app/release.keystore`, alias `candleup`, password `candleup`.
- **Keep this file.** Android only installs an update over the existing app if the update is signed with the same key.

### Install on a phone
1. Copy the APK to the phone.
2. Allow "Install unknown apps".
3. If Play Protect warns, tap "Install anyway".

### Testing status
- There's no emulator or device on this machine, so the APK was **not run on a real phone**.
- Verified so far:
  - APK signature (v2 and v3 schemes)
  - contents and manifest (`aapt dump badging`)
  - the bundled assets running in Chrome at phone width

---

## 7. Known limitations
- The app and web page only scan **while open**. The app keeps the screen on for this. There are no background scans or alerts when closed; that would need an Android foreground service.
- This is pattern matching, not a prediction. A flat base can also break **down**, so always use a stop-loss (e.g. below the box low).
- In some regions Binance API access is blocked. The dashboard shows "Scan failed" in that case.

## 8. Possible next steps
- Make the box length (now 7h) and the tightness thresholds adjustable in the UI.
- Background scanning service in the Android app, so alerts arrive with the screen off.
- Telegram alerts.
- Signal history log, to measure how often SIGNALs actually went up.
- Other timeframes (5m, 1h).
