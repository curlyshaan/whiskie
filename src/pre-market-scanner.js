import fmp from './fmp.js';
import newsSearch from './news-search.js';
import * as db from './db.js';

/**
 * Pre-Market Gap Scanner
 * Runs at 9:00 AM ET — 60 minutes before main analysis
 * Identifies overnight gaps across positions and watchlist
 */

export async function runPreMarketScan() {
  console.log('\n🌅 9:00 AM Pre-Market Scan starting...');

  try {
    // Get all symbols to scan
    const positions = await db.getPositions();
    const watchlist = await db.getWatchlist();
    const positionSymbols = positions.map(p => p.symbol);
    const watchlistSymbols = watchlist.map(w => w.symbol);
    const allSymbols = [...new Set([...positionSymbols, ...watchlistSymbols])];

    if (allSymbols.length === 0) {
      console.log('   No symbols to scan');
      return null;
    }

    // Fetch true off-hours quotes plus prior closes
    const [aftermarketQuotes, regularQuotes] = await Promise.all([
      fmp.getAftermarketQuotes(allSymbols),
      fmp.getQuotes(allSymbols.join(','))
    ]);
    const afterMarketMap = new Map(
      (Array.isArray(aftermarketQuotes) ? aftermarketQuotes : [aftermarketQuotes])
        .filter(Boolean)
        .map(quote => [String(quote.symbol || '').toUpperCase(), quote])
    );
    const regularQuoteMap = new Map(
      (Array.isArray(regularQuotes) ? regularQuotes : [regularQuotes])
        .filter(Boolean)
        .map(quote => [String(quote.symbol || '').toUpperCase(), quote])
    );

    const gaps = [];
    const alerts = [];

    for (const symbol of allSymbols) {
      const normalizedSymbol = String(symbol || '').toUpperCase();
      const afterHoursQuote = afterMarketMap.get(normalizedSymbol);
      const regularQuote = regularQuoteMap.get(normalizedSymbol);
      if (!afterHoursQuote || !regularQuote) continue;

      // Pre-market price vs prior close
      const preMarketPrice = getReliablePremarketPrice(afterHoursQuote);
      const priorClose = Number(regularQuote.previousClose);

      if (!preMarketPrice || !priorClose) continue;

      const gapPct = ((preMarketPrice - priorClose) / priorClose) * 100;
      const isPosition = positionSymbols.includes(normalizedSymbol);

      // Only flag meaningful gaps (>2% for watchlist, >1.5% for held positions)
      const threshold = isPosition ? 1.5 : 2.0;
      if (Math.abs(gapPct) < threshold) continue;

      const direction = gapPct > 0 ? 'UP' : 'DOWN';
      const gapInfo = {
        symbol: normalizedSymbol,
        gapPct: gapPct.toFixed(2),
        direction,
        preMarketPrice: preMarketPrice.toFixed(2),
        priorClose: priorClose.toFixed(2),
        isHeldPosition: isPosition,
      };

      gaps.push(gapInfo);

      // Fetch quick news for significant gaps (>3%)
      if (Math.abs(gapPct) > 3) {
        try {
          const news = await newsSearch.searchStructuredPremarketContext(normalizedSymbol, { maxResults: 2 });
          gapInfo.newsHeadlines = newsSearch.formatResults(news);
        } catch (e) {
          gapInfo.newsHeadlines = 'News unavailable';
        }
      }

      // Alert on held positions gapping significantly
      if (isPosition && Math.abs(gapPct) > 4) {
        alerts.push(`🚨 ${normalizedSymbol} gapped ${direction} ${Math.abs(gapPct).toFixed(1)}% pre-market — review position`);
      }
    }

    // Sort by absolute gap size
    gaps.sort((a, b) => Math.abs(parseFloat(b.gapPct)) - Math.abs(parseFloat(a.gapPct)));

    const report = {
      scanTime: new Date().toISOString(),
      totalScanned: allSymbols.length,
      significantGaps: gaps.length,
      gaps,
      alerts,
      summary: buildGapSummary(gaps),
    };

    console.log(`✅ Pre-market scan complete: ${gaps.length} significant gaps found`);
    if (alerts.length > 0) {
      alerts.forEach(a => console.log(`   ${a}`));
    }

    return report;

  } catch (error) {
    console.error('❌ Pre-market scan failed:', error.message);
    return null;
  }
}

function getReliablePremarketPrice(quote) {
  const candidates = [
    quote.askPrice,
    quote.bidPrice
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
}

function buildGapSummary(gaps) {
  if (gaps.length === 0) return 'No significant pre-market gaps detected.';

  const heldGaps = gaps.filter(g => g.isHeldPosition);
  const watchlistGaps = gaps.filter(g => !g.isHeldPosition);

  let summary = '';

  if (heldGaps.length > 0) {
    summary += 'HELD POSITIONS WITH GAPS:\n';
    heldGaps.forEach(g => {
      summary += `  ${g.symbol}: ${g.direction} ${Math.abs(g.gapPct)}% ($${g.priorClose} → $${g.preMarketPrice})\n`;
      if (g.newsHeadlines) summary += `  News: ${g.newsHeadlines}\n`;
    });
  }

  if (watchlistGaps.length > 0) {
    summary += '\nWATCHLIST GAPS (potential opportunities):\n';
    watchlistGaps.forEach(g => {
      summary += `  ${g.symbol}: ${g.direction} ${Math.abs(g.gapPct)}% ($${g.priorClose} → $${g.preMarketPrice})\n`;
    });
  }

  return summary;
}
