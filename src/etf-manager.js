import * as db from './db.js';
import fmp from './fmp.js';
import tradier from './tradier.js';
import { resolveMarketPrice } from './utils.js';

/**
 * ETF Manager
 * Handles ETF watchlist separately from stock screening
 * ETFs are used for hedging, sector exposure, and diversification
 */

class ETFManager {
  constructor() {
    // Common ETF categories
    this.CATEGORIES = {
      EQUITY_BROAD: 'Broad Market Equity',
      EQUITY_SECTOR: 'Sector/Industry',
      EQUITY_INTERNATIONAL: 'International Equity',
      FIXED_INCOME: 'Fixed Income',
      COMMODITY: 'Commodity',
      VOLATILITY: 'Volatility',
      LEVERAGED: 'Leveraged/Inverse',
      THEMATIC: 'Thematic'
    };

    // Core ETF universe for hedging/exposure
    this.CORE_ETFS = [
      // Broad Market
      { symbol: 'SPY', name: 'SPDR S&P 500', category: this.CATEGORIES.EQUITY_BROAD, purpose: 'US large-cap exposure' },
      { symbol: 'QQQ', name: 'Invesco QQQ', category: this.CATEGORIES.EQUITY_BROAD, purpose: 'Tech/growth exposure' },
      { symbol: 'IWM', name: 'iShares Russell 2000', category: this.CATEGORIES.EQUITY_BROAD, purpose: 'Small-cap exposure' },
      { symbol: 'VTI', name: 'Vanguard Total Stock Market', category: this.CATEGORIES.EQUITY_BROAD, purpose: 'Total US market' },

      // Sector
      { symbol: 'XLF', name: 'Financial Select Sector', category: this.CATEGORIES.EQUITY_SECTOR, purpose: 'Financial sector' },
      { symbol: 'XLE', name: 'Energy Select Sector', category: this.CATEGORIES.EQUITY_SECTOR, purpose: 'Energy sector' },
      { symbol: 'XLK', name: 'Technology Select Sector', category: this.CATEGORIES.EQUITY_SECTOR, purpose: 'Tech sector' },
      { symbol: 'XLV', name: 'Health Care Select Sector', category: this.CATEGORIES.EQUITY_SECTOR, purpose: 'Healthcare sector' },
      { symbol: 'SMH', name: 'VanEck Semiconductor', category: this.CATEGORIES.EQUITY_SECTOR, purpose: 'Semiconductor exposure' },

      // International
      { symbol: 'EFA', name: 'iShares MSCI EAFE', category: this.CATEGORIES.EQUITY_INTERNATIONAL, purpose: 'Developed markets ex-US' },
      { symbol: 'EEM', name: 'iShares MSCI Emerging Markets', category: this.CATEGORIES.EQUITY_INTERNATIONAL, purpose: 'Emerging markets' },
      { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets', category: this.CATEGORIES.EQUITY_INTERNATIONAL, purpose: 'International developed' },

      // Fixed Income
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury', category: this.CATEGORIES.FIXED_INCOME, purpose: 'Long-term treasuries hedge' },
      { symbol: 'AGG', name: 'iShares Core US Aggregate Bond', category: this.CATEGORIES.FIXED_INCOME, purpose: 'Broad bond exposure' },
      { symbol: 'LQD', name: 'iShares iBoxx Investment Grade', category: this.CATEGORIES.FIXED_INCOME, purpose: 'Corporate bonds' },

      // Commodities
      { symbol: 'GLD', name: 'SPDR Gold Shares', category: this.CATEGORIES.COMMODITY, purpose: 'Gold hedge' },
      { symbol: 'SLV', name: 'iShares Silver Trust', category: this.CATEGORIES.COMMODITY, purpose: 'Silver exposure' },
      { symbol: 'USO', name: 'United States Oil Fund', category: this.CATEGORIES.COMMODITY, purpose: 'Oil exposure' },

      // Volatility
      { symbol: 'VXX', name: 'iPath Series B S&P 500 VIX', category: this.CATEGORIES.VOLATILITY, purpose: 'Volatility hedge' },
      { symbol: 'VIXY', name: 'ProShares VIX Short-Term Futures', category: this.CATEGORIES.VOLATILITY, purpose: 'Short-term vol hedge' }
    ];
  }

  /**
   * Initialize ETF watchlist with core ETFs
   */
  async initializeETFWatchlist() {
    console.log('📊 Initializing ETF watchlist...');

    let added = 0;
    let updated = 0;

    for (const etf of this.CORE_ETFS) {
      try {
        // Get current price
        const quote = await fmp.getQuote(etf.symbol);
        const price = quote?.price || quote?.previousClose || quote?.close || 0;
        const volume = quote?.averageVolume || 0;

        // Check if ETF already exists
        const existing = await db.query(
          'SELECT id FROM etf_watchlist WHERE symbol = $1',
          [etf.symbol]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await db.query(
            `UPDATE etf_watchlist
             SET name = $1, category = $2, purpose = $3, current_price = $4,
                 avg_daily_volume = $5, last_updated = CURRENT_TIMESTAMP
             WHERE symbol = $6`,
            [etf.name, etf.category, etf.purpose, price, volume, etf.symbol]
          );
          updated++;
        } else {
          // Insert new
          await db.query(
            `INSERT INTO etf_watchlist
             (symbol, name, category, purpose, current_price, avg_daily_volume)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [etf.symbol, etf.name, etf.category, etf.purpose, price, volume]
          );
          added++;
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.warn(`⚠️ Error adding ETF ${etf.symbol}:`, error.message);
      }
    }

    console.log(`✅ ETF watchlist initialized: ${added} added, ${updated} updated`);
  }

  /**
   * Get all active ETFs from watchlist
   */
  async getActiveETFs() {
    const result = await db.query(
      `SELECT * FROM etf_watchlist
       WHERE status = 'active'
       ORDER BY category, symbol`
    );
    return result.rows;
  }

  /**
   * Get ETFs by category
   */
  async getETFsByCategory(category) {
    const result = await db.query(
      `SELECT * FROM etf_watchlist
       WHERE category = $1 AND status = 'active'
       ORDER BY symbol`,
      [category]
    );
    return result.rows;
  }

  /**
   * Update ETF prices
   */
  async updateETFPrices() {
    const etfs = await this.getActiveETFs();
    const symbols = etfs.map(e => e.symbol);

    if (symbols.length === 0) return;

    const quotes = await fmp.getQuotes(symbols);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
    const marketOpen = await tradier.isMarketOpen().catch(() => false);

    for (const quote of quotesArray) {
      if (!quote || !quote.symbol) continue;

      const price = resolveMarketPrice(quote, { marketOpen, fallback: 0 });
      const volume = quote.averageVolume || 0;

      await db.query(
        `UPDATE etf_watchlist
         SET current_price = $1, avg_daily_volume = $2, last_updated = CURRENT_TIMESTAMP
         WHERE symbol = $3`,
        [price, volume, quote.symbol]
      );
    }
  }

  /**
   * Add custom ETF to watchlist
   */
  async addETF(symbol, name, category, purpose) {
    const quote = await fmp.getQuote(symbol);
    const price = quote?.price || quote?.previousClose || quote?.close || 0;
    const volume = quote?.averageVolume || 0;

    await db.query(
      `INSERT INTO etf_watchlist
       (symbol, name, category, purpose, current_price, avg_daily_volume)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (symbol) DO UPDATE SET
         name = $2, category = $3, purpose = $4,
         current_price = $5, avg_daily_volume = $6,
         last_updated = CURRENT_TIMESTAMP`,
      [symbol, name, category, purpose, price, volume]
    );

    console.log(`✅ Added ETF ${symbol} to watchlist`);
  }

  /**
   * Remove ETF from watchlist
   */
  async removeETF(symbol) {
    await db.query(
      `UPDATE etf_watchlist SET status = 'inactive' WHERE symbol = $1`,
      [symbol]
    );
    console.log(`✅ Removed ETF ${symbol} from watchlist`);
  }

  /**
   * Get ETF summary for Opus analysis
   */
  async getETFSummaryForOpus() {
    const etfs = await this.getActiveETFs();

    const summary = {
      hedging: [],
      sector_exposure: [],
      international: [],
      fixed_income: [],
      commodities: []
    };

    for (const etf of etfs) {
      const item = {
        symbol: etf.symbol,
        name: etf.name,
        purpose: etf.purpose,
        price: etf.current_price
      };

      if (etf.category === this.CATEGORIES.VOLATILITY ||
          etf.category === this.CATEGORIES.FIXED_INCOME) {
        summary.hedging.push(item);
      } else if (etf.category === this.CATEGORIES.EQUITY_SECTOR) {
        summary.sector_exposure.push(item);
      } else if (etf.category === this.CATEGORIES.EQUITY_INTERNATIONAL) {
        summary.international.push(item);
      } else if (etf.category === this.CATEGORIES.FIXED_INCOME) {
        summary.fixed_income.push(item);
      } else if (etf.category === this.CATEGORIES.COMMODITY) {
        summary.commodities.push(item);
      }
    }

    return summary;
  }
}

export default new ETFManager();
