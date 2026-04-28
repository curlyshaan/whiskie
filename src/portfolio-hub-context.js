import * as db from './db.js';
import fmp from './fmp.js';
import quoteService from './services/quote-service.js';
import analysisEngine from './analysis.js';

function normalizePathway(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeReasonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value)
    .split(/\s*[;\n]\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function buildWhiskieContextForSymbol(symbol, dailyStateMap, saturdayWatchlistMap) {
  const dailyState = dailyStateMap.get(symbol) || null;
  const saturdayRow = saturdayWatchlistMap.get(symbol) || null;
  const pathway = normalizePathway(
    pickFirstDefined(
      dailyState?.primary_pathway,
      saturdayRow?.primary_pathway,
      saturdayRow?.pathway
    )
  );

  return {
    symbol,
    pathway,
    secondaryPathways: Array.isArray(saturdayRow?.secondary_pathways)
      ? saturdayRow.secondary_pathways
      : [],
    thesisSummary: pickFirstDefined(dailyState?.thesis_summary, saturdayRow?.opus_reasoning, saturdayRow?.reasons),
    catalystSummary: pickFirstDefined(dailyState?.catalyst_summary, saturdayRow?.reasons),
    lastAction: pickFirstDefined(dailyState?.last_action, saturdayRow?.intent),
    holdingPosture: dailyState?.holding_posture || null,
    sourceReasons: normalizeReasonList(dailyState?.source_reasons || saturdayRow?.reasons),
    watchlistIntent: saturdayRow?.intent || null,
    watchlistPrice: Number(saturdayRow?.price || 0) || null
  };
}

export async function buildPortfolioHubSymbolContext(symbols = []) {
  const normalizedSymbols = [...new Set((symbols || []).map(symbol => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  if (!normalizedSymbols.length) {
    return {
      earningsMap: new Map(),
      stockInfoMap: new Map(),
      quoteMap: new Map(),
      whiskieContextMap: new Map(),
      technicalsMap: new Map()
    };
  }

  const [dailyStates, saturdayRows, earningsRows, stockInfoRows, quotes, technicals] = await Promise.all([
    db.getLatestDailySymbolStates ? db.getLatestDailySymbolStates(normalizedSymbols).catch(() => []) : Promise.resolve([]),
    db.getCanonicalSaturdayWatchlistRows ? db.getCanonicalSaturdayWatchlistRows(['active', 'pending'], { includePromoted: true }).catch(() => []) : Promise.resolve([]),
    db.query(
      `SELECT DISTINCT ON (symbol) symbol, earnings_date
       FROM earnings_calendar
       WHERE symbol = ANY($1) AND earnings_date >= CURRENT_DATE
       ORDER BY symbol, earnings_date ASC`,
      [normalizedSymbols]
    ).then(result => result.rows).catch(() => []),
    db.query(
      `SELECT symbol, company_name, sector, industry
       FROM stock_universe
       WHERE symbol = ANY($1)`,
      [normalizedSymbols]
    ).then(result => result.rows).catch(() => []),
    Promise.all(normalizedSymbols.map(symbol => quoteService.getQuote(symbol).catch(() => null))),
    Promise.all(normalizedSymbols.map(symbol => analysisEngine.getTechnicalIndicators(symbol).catch(() => null)))
  ]);

  const earningsMap = new Map(earningsRows.map(row => [row.symbol, row.earnings_date]));
  const stockInfoMap = new Map(stockInfoRows.map(row => [row.symbol, {
    ...row,
    sectorSource: 'stock_universe'
  }]));
  const quoteMap = new Map(normalizedSymbols.map((symbol, index) => [symbol, quotes[index] || null]));
  const technicalsMap = new Map(normalizedSymbols.map((symbol, index) => [symbol, technicals[index] || null]));
  const dailyStateMap = new Map((dailyStates || []).map(row => [row.symbol, row]));
  const saturdayWatchlistMap = new Map(
    (saturdayRows || [])
      .filter(row => normalizedSymbols.includes(String(row.symbol || '').toUpperCase()))
      .map(row => [String(row.symbol || '').toUpperCase(), row])
  );

  for (const symbol of normalizedSymbols) {
    if (stockInfoMap.has(symbol)) continue;
    const fmpProfile = await fmp.getProfile(symbol).catch(() => null);
    if (fmpProfile?.sector || fmpProfile?.industry) {
      stockInfoMap.set(symbol, {
        symbol,
        company_name: fmpProfile.companyName || fmpProfile.company_name || symbol,
        sector: fmpProfile.sector || null,
        industry: fmpProfile.industry || null,
        sectorSource: 'fmp'
      });
    }
  }

  const whiskieContextMap = new Map(
    normalizedSymbols.map(symbol => [
      symbol,
      buildWhiskieContextForSymbol(symbol, dailyStateMap, saturdayWatchlistMap)
    ])
  );

  return {
    earningsMap,
    stockInfoMap,
    quoteMap,
      whiskieContextMap,
      technicalsMap
  };
}
