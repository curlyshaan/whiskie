import fetch from 'node-fetch';

/**
 * Extended Yahoo Finance API wrapper
 * Provides comprehensive fundamental data as free alternative to FMP
 * No authentication required, unlimited calls
 */
class YahooFinanceExtended {
  constructor() {
    this.BASE_URL = 'https://query1.finance.yahoo.com';
    this.USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  }

  /**
   * Make request to Yahoo Finance API
   */
  async request(url) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.USER_AGENT }
      });

      if (!response.ok) {
        throw new Error(`Yahoo Finance returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Yahoo Finance request failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get comprehensive fundamental data for a symbol
   * Replaces FMP getFundamentals() with free Yahoo Finance data
   */
  async getFundamentals(symbol) {
    try {
      const modules = [
        'summaryProfile',
        'financialData',
        'defaultKeyStatistics',
        'summaryDetail',
        'price'
      ].join(',');

      const url = `${this.BASE_URL}/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
      const data = await this.request(url);

      const result = data?.quoteSummary?.result?.[0];
      if (!result) return null;

      const profile = result.summaryProfile || {};
      const financial = result.financialData || {};
      const keyStats = result.defaultKeyStatistics || {};
      const summary = result.summaryDetail || {};
      const priceData = result.price || {};

      return {
        symbol,

        // Company info
        companyName: priceData.longName || priceData.shortName || symbol,
        sector: profile.sector || 'Unknown',
        industry: profile.industry || 'Unknown',
        marketCap: priceData.marketCap?.raw || 0,

        // Valuation metrics
        peRatio: summary.trailingPE?.raw || 0,
        forwardPE: summary.forwardPE?.raw || 0,
        pegRatio: keyStats.pegRatio?.raw || 0,
        priceToBook: keyStats.priceToBook?.raw || 0,
        priceToSales: summary.priceToSalesTrailing12Months?.raw || 0,

        // Growth metrics
        revenueGrowth: financial.revenueGrowth?.raw || 0,
        earningsGrowth: financial.earningsGrowth?.raw || 0,

        // Financial health
        debtToEquity: financial.debtToEquity?.raw || 0,
        currentRatio: financial.currentRatio?.raw || 0,
        quickRatio: financial.quickRatio?.raw || 0,

        // Profitability
        operatingMargin: financial.operatingMargins?.raw || 0,
        profitMargin: financial.profitMargins?.raw || 0,
        netMargin: financial.profitMargins?.raw || 0,
        roe: financial.returnOnEquity?.raw || 0,
        roa: financial.returnOnAssets?.raw || 0,

        // Cash flow
        freeCashflow: financial.freeCashflow?.raw || 0,
        operatingCashflow: financial.operatingCashflow?.raw || 0,
        freeCashflowPerShare: keyStats.freeCashflow?.raw ?
          (keyStats.freeCashflow.raw / (keyStats.sharesOutstanding?.raw || 1)) : 0,

        // Price data
        price: priceData.regularMarketPrice?.raw || 0,
        beta: keyStats.beta?.raw || 0,
        fiftyTwoWeekHigh: summary.fiftyTwoWeekHigh?.raw || 0,
        fiftyTwoWeekLow: summary.fiftyTwoWeekLow?.raw || 0,

        // Additional metrics
        dividendYield: summary.dividendYield?.raw || 0,
        payoutRatio: summary.payoutRatio?.raw || 0,
        targetMeanPrice: financial.targetMeanPrice?.raw || 0,
        numberOfAnalystOpinions: financial.numberOfAnalystOpinions?.raw || 0,
        recommendationKey: financial.recommendationKey || 'none'
      };
    } catch (error) {
      console.error(`Error fetching Yahoo fundamentals for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get quote data (real-time price, volume, etc.)
   */
  async getQuote(symbol) {
    try {
      const url = `${this.BASE_URL}/v7/finance/quote?symbols=${symbol}`;
      const data = await this.request(url);

      const quote = data?.quoteResponse?.result?.[0];
      if (!quote) return null;

      return {
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        avgVolume: quote.averageDailyVolume3Month,
        marketCap: quote.marketCap,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        open: quote.regularMarketOpen,
        previousClose: quote.regularMarketPreviousClose,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow
      };
    } catch (error) {
      console.error(`Error fetching Yahoo quote for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get multiple quotes at once
   */
  async getQuotes(symbols) {
    try {
      const symbolList = Array.isArray(symbols) ? symbols.join(',') : symbols;
      const url = `${this.BASE_URL}/v7/finance/quote?symbols=${symbolList}`;
      const data = await this.request(url);

      return data?.quoteResponse?.result || [];
    } catch (error) {
      console.error(`Error fetching Yahoo quotes:`, error.message);
      return [];
    }
  }

  /**
   * Get financial statements (income, balance sheet, cash flow)
   */
  async getFinancials(symbol) {
    try {
      const modules = 'incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory';
      const url = `${this.BASE_URL}/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
      const data = await this.request(url);

      const result = data?.quoteSummary?.result?.[0];
      if (!result) return null;

      return {
        incomeStatement: result.incomeStatementHistory?.incomeStatementHistory || [],
        balanceSheet: result.balanceSheetHistory?.balanceSheetStatements || [],
        cashFlow: result.cashflowStatementHistory?.cashflowStatements || []
      };
    } catch (error) {
      console.error(`Error fetching Yahoo financials for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get earnings history and estimates
   */
  async getEarnings(symbol) {
    try {
      const modules = 'earningsHistory,earningsTrend,earnings';
      const url = `${this.BASE_URL}/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
      const data = await this.request(url);

      const result = data?.quoteSummary?.result?.[0];
      if (!result) return null;

      return {
        history: result.earningsHistory?.history || [],
        trend: result.earningsTrend?.trend || [],
        quarterly: result.earnings?.earningsChart?.quarterly || [],
        annual: result.earnings?.financialsChart?.yearly || []
      };
    } catch (error) {
      console.error(`Error fetching Yahoo earnings for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get analyst recommendations and price targets
   */
  async getAnalystData(symbol) {
    try {
      const modules = 'recommendationTrend,financialData';
      const url = `${this.BASE_URL}/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
      const data = await this.request(url);

      const result = data?.quoteSummary?.result?.[0];
      if (!result) return null;

      const financial = result.financialData || {};
      const recommendations = result.recommendationTrend?.trend || [];

      return {
        targetMeanPrice: financial.targetMeanPrice?.raw || 0,
        targetHighPrice: financial.targetHighPrice?.raw || 0,
        targetLowPrice: financial.targetLowPrice?.raw || 0,
        numberOfAnalysts: financial.numberOfAnalystOpinions?.raw || 0,
        recommendationKey: financial.recommendationKey || 'none',
        recommendationMean: financial.recommendationMean?.raw || 0,
        recommendations: recommendations
      };
    } catch (error) {
      console.error(`Error fetching Yahoo analyst data for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get historical price data
   */
  async getHistoricalData(symbol, startDate, endDate) {
    try {
      const period1 = Math.floor(startDate.getTime() / 1000);
      const period2 = Math.floor(endDate.getTime() / 1000);

      const url = `${this.BASE_URL}/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
      const data = await this.request(url);

      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        return [];
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];

      return timestamps
        .map((timestamp, i) => ({
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i]
        }))
        .filter(bar => bar.close !== null && bar.close !== undefined);
    } catch (error) {
      console.error(`Error fetching Yahoo historical data for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Get short interest data
   */
  async getShortInterest(symbol) {
    try {
      const url = `${this.BASE_URL}/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics`;
      const data = await this.request(url);

      const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
      if (!stats) return null;

      return {
        shortPercentOfFloat: stats.shortPercentOfFloat?.raw || 0,
        sharesShort: stats.sharesShort?.raw || 0,
        shortRatio: stats.shortRatio?.raw || 0,
        sharesOutstanding: stats.sharesOutstanding?.raw || 0
      };
    } catch (error) {
      console.warn(`Could not fetch short interest for ${symbol}:`, error.message);
      return null;
    }
  }
}

export default new YahooFinanceExtended();
