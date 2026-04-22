import * as db from './db.js';
import fmp from './fmp.js';

export async function buildPortfolioHubSymbolContext(symbols = [], whiskiePositionsMap = new Map()) {
  const normalizedSymbols = [...new Set((symbols || []).map(symbol => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  if (!normalizedSymbols.length) {
    return {
      earningsMap: new Map(),
      stockInfoMap: new Map(),
      profileMap: {},
      quoteMap: new Map()
    };
  }

  const [profiles, earningsRows, stockInfoRows, quotes] = await Promise.all([
    db.getLatestStockProfilesForSymbols ? db.getLatestStockProfilesForSymbols(normalizedSymbols).catch(() => ({})) : Promise.resolve({}),
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
    Promise.all(normalizedSymbols.map(symbol => fmp.getQuote(symbol).catch(() => null)))
  ]);

  const earningsMap = new Map(earningsRows.map(row => [row.symbol, row.earnings_date]));
  const stockInfoMap = new Map(stockInfoRows.map(row => [row.symbol, row]));
  const quoteMap = new Map(normalizedSymbols.map((symbol, index) => [symbol, quotes[index] || null]));

  return {
    earningsMap,
    stockInfoMap,
    profileMap: profiles,
    quoteMap,
    whiskiePositionsMap
  };
}
