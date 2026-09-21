/*
 * Pattern scanner: quiet base at the END of the 15m chart (from the marked ZECUSDT chart).
 *
 *   1. BASE   - the latest N candles (user setting, default 20 = 5h) are a tight sideways box: small candles (less volatile than
 *               the day before), MA7 & MA25 flat and tangled together, quiet volume.
 *   2. PUSH   - in the newest candles price starts lifting: green candles closing above MA7 and
 *               MA25 in the upper part of the box, MA7 turning above MA25.
 *   3. EARLY  - price is still at/near the top of the box, it has not run away yet.
 *
 * Works in the browser (window.Scanner) and in Node (module.exports).
 */
(function (root) {
  const API_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

  // Stablecoins / fiat / pegged assets - these never make this pattern in a useful way.
  const EXCLUDED_BASES = new Set([
    "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "EUR", "GBP", "AEUR", "EURI",
    "USDE", "XUSD", "RLUSD", "BFUSD", "USD1", "PAXG", "XAUT", "UST", "USTC", "PYUSD", "U",
  ]);

  const CFG = {
    box: 20,     // default box = last 20 candles (5 hours), ending at the newest candle (user setting)
    minBox: 8,
    maxBox: 96,
    edge: 3,     // newest 3 candles of the box = where the first push shows up
    ref: 96,     // 24 hours before the box = "normal" candle size / volume to compare against
  };
  const clampBox = (b) => Math.max(CFG.minBox, Math.min(CFG.maxBox, Math.round(b) || CFG.box));

  // candles to download: 24h reference + box + 1 for the candle that is still forming
  const candlesNeeded = (box) => CFG.ref + clampBox(box) + 1;

  // ---------- helpers ----------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const median = (a) => {
    const b = [...a].sort((x, y) => x - y);
    return b.length ? b[Math.floor(b.length / 2)] : 0;
  };

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  async function getJSON(path) {
    let lastErr;
    for (const host of API_HOSTS) {
      try {
        const res = await fetch(host + path);
        if (res.status === 429 || res.status === 418) {
          throw new Error("Rate limited by Binance (HTTP " + res.status + ")");
        }
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  // ---------- data ----------
  // Binance tokenized stocks (NVDAB, TSLAB, SPYB...) all carry this permission group.
  // They go flat whenever the US market is closed, which fakes a "quiet base".
  const STOCK_TOKEN_GROUP = "TRD_GRP_261";

  async function loadUniverse(minQuoteVolume, { includeStocks = false } = {}) {
    const [info, tickers] = await Promise.all([
      getJSON("/api/v3/exchangeInfo?permissions=SPOT&symbolStatus=TRADING"),
      getJSON("/api/v3/ticker/24hr"),
    ]);
    const spot = new Map();
    for (const s of info.symbols) {
      if (s.quoteAsset !== "USDT" || s.status !== "TRADING") continue;
      if (EXCLUDED_BASES.has(s.baseAsset)) continue;
      if (/(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset) && s.baseAsset.length > 4) continue;
      const isStock = (s.permissionSets || []).some((set) => set.includes(STOCK_TOKEN_GROUP));
      if (isStock && !includeStocks) continue;
      spot.set(s.symbol, s);
    }
    return tickers
      .filter((t) => spot.has(t.symbol) && parseFloat(t.quoteVolume) >= minQuoteVolume)
      .map((t) => ({
        symbol: t.symbol,
        base: spot.get(t.symbol).baseAsset,
        price: parseFloat(t.lastPrice),
        change24h: parseFloat(t.priceChangePercent),
        quoteVolume: parseFloat(t.quoteVolume),
      }))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);
  }

  async function loadCandles(symbol, limit = candlesNeeded(CFG.box)) {
    const raw = await getJSON(`/api/v3/klines?symbol=${symbol}&interval=15m&limit=${limit}`);
    return raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      volume: +k[7], // quote (USDT) volume
      closeTime: k[6],
    }));
  }

  // ---------- pattern analysis ----------
  // The consolidation box is always the LATEST candles (right edge of the chart), so a coin
  // ranks high only while it is sitting in the quiet base now / just starting to lift out of it.
  function analyze(allCandles, { closedOnly = true, box: boxLen = CFG.box } = {}) {
    let candles = allCandles;
    if (closedOnly && candles.length && candles[candles.length - 1].closeTime > Date.now()) {
      candles = candles.slice(0, -1);
    }
    const BOX = clampBox(boxLen);
    const need = BOX + CFG.ref;
    if (candles.length < need) return null;

    const n = candles.length;
    const L = n - 1;
    const closes = candles.map((c) => c.close);
    const ma7 = sma(closes, 7);
    const ma25 = sma(closes, 25);
    const isGreen = (c) => c.close > c.open;
    const last = candles[L];

    const boxStart = n - BOX;
    const box = candles.slice(boxStart);                   // the base, ending at the last candle
    const core = candles.slice(boxStart, n - CFG.edge);    // base without the newest candles
    const edge = candles.slice(n - CFG.edge);              // newest candles (the first push)
    const ref = candles.slice(boxStart - CFG.ref, boxStart);

    const rangePct = (c) => (c.high - c.low) / c.close;
    const atrRef = mean(ref.map(rangePct)) || 1e-9;

    // --- 1. BASE quality (measured on the box) ---
    // a) small candles: volatility in the box vs the 24h before it
    const compression = mean(box.map(rangePct)) / atrRef;
    const sCompression = clamp01((1.1 - compression) / 0.55);

    // b) tight box: height of the core box in "normal" candle ranges
    const boxHigh = Math.max(...core.map((c) => c.high));
    const boxLow = Math.min(...core.map((c) => c.low));
    const boxMid = (boxHigh + boxLow) / 2;
    const boxWidthPct = (boxHigh - boxLow) / boxMid;
    const widthInAtr = boxWidthPct / atrRef;
    const sTight = clamp01((16 - widthInAtr) / 10);

    // c) sideways: little net drift across the core box
    const drift = Math.abs(core[core.length - 1].close - core[0].open) / boxMid;
    const sFlat = clamp01(1 - drift / Math.max(boxWidthPct, 1e-9));

    // d) MA7 and MA25 flat and tangled together inside the box
    let spread = 0;
    for (let i = boxStart; i < n - CFG.edge; i++) spread += Math.abs(ma7[i] - ma25[i]) / closes[i];
    spread /= core.length;
    const sTangle = clamp01(1 - spread / (atrRef * 2));
    const ma25Slope = Math.abs(ma25[L] - ma25[boxStart]) / ma25[L] / atrRef;
    const sMaFlat = clamp01(1 - (ma25Slope - 1) / 4);

    // e) quiet volume in the box
    const volCore = mean(core.map((c) => c.volume)) || 1e-9;
    const volRef = mean(ref.map((c) => c.volume)) || 1e-9;
    const quietVol = volCore / volRef;
    const sQuietVol = clamp01((1.3 - quietVol) / 0.6);

    const base = 18 * sCompression + 16 * sTight + 9 * sFlat + 8 * sTangle + 4 * sMaFlat + 5 * sQuietVol; // /60

    // --- 2. FIRST PUSH at the right edge (price starting to lift, still near the box) ---
    const aboveMas = last.close > ma7[L] && last.close > ma25[L];
    const maBull = ma7[L] > ma25[L];
    let crossAgo = -1;
    for (let i = L; i > L - 10; i--) {
      if (ma7[i] > ma25[i] && ma7[i - 1] <= ma25[i - 1]) { crossAgo = L - i; break; }
    }
    const sCross = maBull ? (crossAgo >= 0 ? 1 : 0.6) : ma7[L] > ma7[L - 2] ? 0.3 : 0;
    const greens = edge.filter(isGreen).length;
    const sGreens = greens / CFG.edge;
    const boxPos = (last.close - boxLow) / Math.max(boxHigh - boxLow, 1e-9); // 0 = bottom, 1 = top
    const sPos = clamp01((boxPos - 0.3) / 0.6);
    const volRatio = mean(edge.map((c) => c.volume)) / volCore;
    const sVol = clamp01((volRatio - 0.9) / 1.1);
    const ma25Up = ma25[L] >= ma25[L - 3];

    const push = 10 * (aboveMas ? 1 : 0) + 8 * sCross + 7 * sGreens + 7 * sPos + 5 * sVol + 3 * (ma25Up ? 1 : 0); // /40

    // --- 3. STILL AT THE START: penalise coins that already ran away from the box ---
    const extAtr = (last.close - boxHigh) / boxHigh / atrRef;
    let lateFactor = 1;
    if (extAtr > 2) lateFactor = 0.3 + 0.7 * clamp01(1 - (extAtr - 2) / 5);

    // a push out of a poor base is just noise
    const score = Math.round((base + push * (0.3 + 0.7 * base / 60)) * lateFactor);

    let stage = "none";
    if (extAtr > 4) stage = "late";
    else if (base >= 38 && score >= 68 && aboveMas && (maBull || crossAgo >= 0) && greens >= 2 && boxPos >= 0.8 && volRatio >= 0.9) stage = "signal";
    else if (base >= 36 && score >= 58 && aboveMas && boxPos >= 0.6) stage = "forming";
    else if (base >= 40) stage = "base";

    return {
      score, stage,
      baseScore: Math.round(base), push: Math.round(push),
      compression, boxWidthPct, quietVol, volRatio,
      boxHigh, boxLow, boxPos, extPct: (last.close - boxHigh) / boxHigh,
      crossAgo, maBull, greens,
      boxStartTime: candles[boxStart].time,
      boxLen: BOX,
      lastClose: last.close, lastTime: last.time,
    };
  }

  const api = { CFG, clampBox, candlesNeeded, loadUniverse, loadCandles, analyze, sma };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Scanner = api;
})(typeof window !== "undefined" ? window : globalThis);
