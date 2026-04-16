> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# Whiskie Final Implementation Plan
**Date**: 2026-04-16
**Status**: Ready for Implementation

---

## CONSOLIDATED OPUS RECOMMENDATIONS

All recommendations from multiple Opus reviews consolidated into prioritized implementation plan.

---

## PHASE 1: CRITICAL FIXES (Week 1)

### 1. Enhanced Trade Approval Reasoning ⚠️ HIGHEST PRIORITY

**Problem**: Current reasoning "Long position in BKNG" is too vague for decision-making.

**Database Migration:**
```sql
ALTER TABLE trade_approvals ADD COLUMN
  investment_thesis TEXT,
  pathway VARCHAR(50),
  strategy_type VARCHAR(50),
  catalysts JSONB,
  fundamentals JSONB,
  technical_setup TEXT,
  risk_factors TEXT,
  holding_period VARCHAR(50),
  confidence VARCHAR(20),
  growth_potential VARCHAR(50),
  news_links JSONB,
  stop_type VARCHAR(20),
  stop_reason TEXT,
  has_fixed_target BOOLEAN,
  target_type VARCHAR(20),
  trailing_stop_pct DECIMAL(5,2),
  rebalance_threshold_pct DECIMAL(5,2),
  max_holding_days INTEGER,
  fundamental_stop_conditions JSONB;
```

**Phase 4 Output Format - Momentum Trade:**
```
EXECUTE_BUY: NVDA | 50 | 800.00 | 760.00 | 950.00
THESIS: AI chip leader, 120% revenue growth, expanding into data center market
PATHWAY: highGrowth
STRATEGY: Momentum Swing (4-6 weeks)
CATALYSTS: Q1 earnings Apr 28 (expect 25% beat); GTC conference May 15; New H100 orders
FUNDAMENTALS: P/E 45, PEG 0.9, Revenue +120% YoY, Gross margin 75%, ROE 85%
TECHNICAL: Broke above $780 resistance, volume +60%, RSI 62, MACD bullish cross
RISKS: China export restrictions, AMD competition. Stop $760 (5% below) protects breakdown
STOP_TYPE: technical
STOP_REASON: Below breakout at $760, volume declining below 20MA
TARGET_TYPE: fixed
TARGET_REASON: Resistance at $950, R:R 3.75:1
MAX_HOLD_DAYS: 56
EXIT_PLAN: Sell 50% at target, trail remaining 50% with 8% stop
HOLDING: 4-6 weeks
CONFIDENCE: High
GROWTH_POTENTIAL: 50-100%
NEWS: [Tavily URLs]
```

**Phase 4 Output Format - Buy-and-Hold:**
```
EXECUTE_BUY: AAPL | 100 | 150.00 | 112.50 | NONE
THESIS: Quality compounder, 28% operating margin, Services growing 14%, trading at 15x P/E vs 22x avg
PATHWAY: qualityCompounder
STRATEGY: Fundamental Hold (12+ months)
CATALYSTS: Q2 earnings Apr 28; WWDC Jun 10 (AI features); iPhone 16 launch Sep
FUNDAMENTALS: P/E 15.2, PEG 0.8, Revenue +8% YoY, Op margin 28%, ROE 42%, FCF $95B
TECHNICAL: Above 200MA at $145, consolidating, RSI 55
RISKS: China demand weakness, regulatory pressure. Fundamental stop if margins <25% or debt/equity >0.5
STOP_TYPE: fundamental
STOP_REASON: Exit if operating margins fall below 25% OR debt/equity exceeds 0.5 OR Services growth <10% for 2 consecutive quarters
CATASTROPHIC_STOP: 112.50 (25% below entry)
TARGET_TYPE: trailing
TRAILING_STOP_PCT: 15.0
REBALANCE_THRESHOLD_PCT: 15.0
REBALANCE_ACTION: Trim to 12% of portfolio if position exceeds 15%
MAX_HOLD_DAYS: null
FUNDAMENTAL_CHECKS: quarterly
HOLDING: 12+ months
CONFIDENCE: High
GROWTH_POTENTIAL: 20-50%
NEWS: [Tavily URLs]
```

**Parser Updates:** `src/trade-approval.js` - Extract all new fields from Phase 4 output

**UI Updates:** `src/dashboard.js` - Display comprehensive trade cards with all details

---

### 2. Pathway Filter Fixes

#### A. QARP Sector-Relative P/E ⚠️ CRITICAL
**Problem**: Flat P/E ceiling of 35 treats all sectors identically (38 stocks, too permissive)

**Fix:** `src/fundamental-screener.js:698-710`
```javascript
// Change from:
if (metrics.peRatio > 35) return { score: 0, reasons: ['P/E >35 - too expensive'] };

// To:
const sectorPE = sectorConfig.peRange || { ideal: 20, high: 30 };
const qarpCeiling = Math.min(sectorPE.ideal * 1.2, sectorPE.high);
if (metrics.peRatio > qarpCeiling) {
  return { score: 0, reasons: [`P/E ${metrics.peRatio.toFixed(1)} > ${qarpCeiling.toFixed(1)} (sector ceiling)`] };
}
```

**Expected Impact**: 38 stocks → ~20-25 stocks (more selective)

#### B. Turnaround AND → OR Logic
**Problem**: Requires operational ≥20 AND financial ≥15 (0 stocks, too strict)

**Fix:** `src/fundamental-screener.js:995-997`
```javascript
// Change from:
if (operationalScore < 20 || financialScore < 15) {
  return { score: 0, reasons: ['Turnaround requires both operational ≥20 AND financial ≥15'] };
}

// To:
if (operationalScore < 15 && financialScore < 12) {
  return { score: 0, reasons: ['Turnaround requires operational ≥15 OR financial ≥12'] };
}
```

**Expected Impact**: 0 stocks → 5-10 stocks

#### C. HighGrowth Sector-Relative Thresholds
**Problem**: Flat growth tiers (15%, 20%, 30%, 50%) ignore sector norms

**Fix:** `src/fundamental-screener.js:467-479`
```javascript
// Change from flat tiers to sector-relative:
const sectorGrowthMin = sectorConfig.revenueGrowthMin || 0.10;

if (metrics.revenueGrowth >= sectorGrowthMin * 3.0) {
  score += 45;
  reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (3x sector min)`);
} else if (metrics.revenueGrowth >= sectorGrowthMin * 2.0) {
  score += 35;
  reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (2x sector min)`);
} else if (metrics.revenueGrowth >= sectorGrowthMin * 1.5) {
  score += 25;
  reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (1.5x sector min)`);
} else if (metrics.revenueGrowth >= sectorGrowthMin * 1.0) {
  score += 15;
  reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (meets sector min)`);
}
```

#### D. Inflection Balance Sheet Relaxation
**Problem**: Balance sheet ≥15 too strict (only 4 stocks)

**Fix:** `src/fundamental-screener.js:595-603`
```javascript
// Change from:
if (balanceScore < 15) {
  return { score: 0, reasons: ['Inflection requires balance sheet score ≥15'] };
}

// To:
if (balanceScore < 10) {
  return { score: 0, reasons: ['Inflection requires balance sheet score ≥10'] };
}
```

**Expected Impact**: 4 stocks → 8-10 stocks

---

### 3. Short Pathway Fixes

#### A. Split Overvalued vs Deteriorating
**Problem**: All 57 shorts labeled "overvalued" regardless of driver

**Fix:** `src/fundamental-screener.js:1249`
```javascript
// Add pathway assignment logic:
let shortPathway = 'overvalued';
if (deteriorationScore > valuationScore * 1.3) {
  shortPathway = 'deteriorating';
} else if (valuationScore > deteriorationScore * 1.3) {
  shortPathway = 'overvalued';
}
```

**Expected Impact**: 57 "overvalued" → split into ~35 overvalued + ~20 deteriorating

#### B. Short Momentum Direction by Pathway
**Problem**: Current uses `Math.abs()` - accepts both +2% and -2%

**Fix:** `src/pre-ranking.js:312-318`
```javascript
const shortMomentumConfig = {
  deteriorating: {
    direction: 'negative',  // Must be declining
    minMove: 0.02,
    minVolumeSurge: 1.5
  },
  overvalued: {
    direction: 'either',   // Any direction
    minMove: 0.02,
    minVolumeSurge: 1.5
  },
  overextended: {
    direction: 'positive', // Must be rallying
    minMove: 0.03,
    minVolumeSurge: 2.0
  }
};

// In momentum filter:
const change = stockData.change; // Remove Math.abs()
const config = shortMomentumConfig[shortType];

let meetsThreshold;
if (config.direction === 'negative') {
  meetsThreshold = change <= -config.minMove * 100 && volumeSurge >= config.minVolumeSurge;
} else if (config.direction === 'positive') {
  meetsThreshold = change >= config.minMove * 100 && volumeSurge >= config.minVolumeSurge;
} else {
  meetsThreshold = Math.abs(change / 100) >= config.minMove && volumeSurge >= config.minVolumeSurge;
}
```

#### C. Short Float Logic Flip for Deteriorating
**Problem**: High short float rejected for all shorts (squeeze risk)

**Fix:** `src/fundamental-screener.js:1120-1143`
```javascript
shortSafetyCheck(metrics, reasons, pathway = 'overvalued') {
  // ... existing checks ...
  
  // Short float check - PATHWAY-SPECIFIC
  if (pathway === 'overvalued' || pathway === 'overextended') {
    // High short float = squeeze risk → reject
    if (metrics.shortFloat && metrics.shortFloat > this.MAX_SHORT_FLOAT) {
      reasons.push(`⚠️ Short float ${(metrics.shortFloat * 100).toFixed(0)}% - squeeze risk`);
      return false;
    }
  } else if (pathway === 'deteriorating') {
    // High short float = corroborating signal → don't reject
    if (metrics.shortFloat && metrics.shortFloat > 0.20) {
      reasons.push(`High short float ${(metrics.shortFloat * 100).toFixed(0)}% - market consensus`);
    }
  }
  
  return true;
}
```

---

### 4. Momentum Bypass Implementation

**Problem**: Phase 1 requires momentum for ALL stocks, killing fundamental buy-and-hold opportunities

**Fix:** `src/pre-ranking.js`

**Add pathway config:**
```javascript
const MOMENTUM_BYPASS_PATHWAYS = new Set([
  'deepValue',
  'cashMachine',
  'qarp',
  'qualityCompounder'
]);

// In scoreStock function (line 272):
async scoreStock(stock, sectorMap, earningsMap) {
  // ... existing code ...
  
  // Check if stock from saturday_watchlist with bypass pathway
  const bypassMomentum = stock.source === 'watchlist' && 
                        MOMENTUM_BYPASS_PATHWAYS.has(stock.pathway);
  
  if (!bypassMomentum) {
    // Apply momentum filter (existing logic)
    const meetsThreshold = Math.abs(change / 100) >= momentumThresholds.minMove &&
                          volumeSurge >= momentumThresholds.minVolumeSurge;
    
    if (!meetsThreshold) {
      return null;
    }
  }
  
  // Continue with scoring...
}
```

**Pathways that bypass momentum:**
- deepValue (patient capital, buy-and-hold)
- cashMachine (stable cash generators)
- qarp (quality at reasonable price)
- qualityCompounder (long-term holds)

**Pathways that require momentum:**
- highGrowth (growth should show in price)
- inflection (change needs confirmation)
- turnaround (turnaround needs confirmation)
- All shorts (timing matters)

---

## PHASE 2: GROWTH IDENTIFICATION (Week 2)

### 5. Expand Stock Universe for Growth

**Problem**: $7B+ market cap excludes small-cap growth ($1B-$7B where multi-baggers emerge)

**Fix:** `scripts/populate-universe-v2.js`
```javascript
async function expandGrowthUniverse() {
  console.log('Fetching growth-focused stocks ($1B-$10B)...');
  
  const growthStocks = await fmp.get('/stock-screener', {
    params: {
      marketCapMoreThan: 1000000000,
      marketCapLowerThan: 10000000000,
      volumeMoreThan: 500000,
      sector: 'Technology,Healthcare,Consumer Cyclical',
      exchange: 'NASDAQ,NYSE',
      limit: 100
    }
  });
  
  // Filter for high-growth characteristics
  const filtered = growthStocks.filter(stock => {
    return (
      stock.revenueGrowth > 25 &&
      stock.grossMargin > 50 &&
      stock.priceChange1Y > 0
    );
  });
  
  console.log(`Found ${filtered.length} growth candidates`);
  
  // Add to stock_universe with growth flag
  for (const stock of filtered) {
    await db.query(`
      INSERT INTO stock_universe (symbol, company_name, market_cap, sector, industry, is_growth_candidate)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (symbol) DO UPDATE SET
        is_growth_candidate = true,
        updated_at = NOW()
    `, [stock.symbol, stock.companyName, stock.marketCap, stock.sector, stock.industry]);
  }
}
```

**Expected Impact**: Universe expands from 377 to ~450-500 stocks, includes small-cap growth

---

### 6. Add Growth Potential Scoring

**Fix:** `src/fundamental-screener.js` - Add new function
```javascript
function scoreGrowthPotential(stock, profile, news) {
  let score = 0;
  let reasons = [];
  
  // Revenue acceleration
  if (stock.revenueGrowthYoY > stock.revenueGrowth3Y * 1.2) {
    score += 20;
    reasons.push('Revenue accelerating');
  }
  
  // Margin expansion
  if (stock.grossMargin > stock.grossMargin1YAgo + 3) {
    score += 15;
    reasons.push('Margin expansion');
  }
  
  // Small cap with high growth
  if (stock.marketCap < 5000000000 && stock.revenueGrowthYoY > 30) {
    score += 25;
    reasons.push('Small-cap high-growth');
  }
  
  // Positive earnings surprise
  if (stock.earningsSurprise > 10) {
    score += 10;
    reasons.push('Beating estimates');
  }
  
  // Insider buying
  if (profile.insiderBuying > profile.insiderSelling * 2) {
    score += 15;
    reasons.push('Strong insider buying');
  }
  
  // Catalyst detection from news
  const catalysts = detectCatalysts(news);
  if (catalysts.length > 0) {
    score += 15;
    reasons.push(`Catalysts: ${catalysts.join(', ')}`);
  }
  
  return {
    score,
    potential: score > 70 ? '2x-3x' : score > 50 ? '50-100%' : score > 30 ? '20-50%' : '<20%',
    reasons
  };
}

function detectCatalysts(news) {
  const catalysts = [];
  const catalystKeywords = {
    'FDA approval': /FDA (approval|cleared|granted)/i,
    'Product launch': /launch(ing|ed)? (new )?product/i,
    'Earnings beat': /beat (earnings|estimates)/i,
    'Partnership': /(partnership|collaboration|deal) with/i,
    'Acquisition': /(acquir(e|ing|ed)|bought)/i,
    'Expansion': /(expand(ing|ed)|entering) (new )?(market|region)/i
  };
  
  for (const [catalyst, regex] of Object.entries(catalystKeywords)) {
    if (news.some(article => regex.test(article.title + ' ' + article.description))) {
      catalysts.push(catalyst);
    }
  }
  
  return catalysts;
}
```

---

### 7. Enhanced Tavily Catalyst Research

**Problem**: Tavily likely used superficially, not finding catalysts

**Fix:** Create `src/catalyst-research.js`
```javascript
import tavily from './tavily.js';

async function researchCatalysts(symbol, pathway) {
  const searches = [
    // Earnings and guidance
    `${symbol} earnings date Q1 2026`,
    `${symbol} analyst estimates consensus`,
    
    // Product and pipeline
    `${symbol} product launch 2026`,
    `${symbol} pipeline updates`,
    
    // Regulatory (for biotech/pharma)
    `${symbol} FDA approval PDUFA date`,
    `${symbol} clinical trial results`,
    
    // Corporate actions
    `${symbol} insider buying recent`,
    `${symbol} analyst upgrade downgrade`,
    `${symbol} partnership deal announcement`,
    
    // Industry trends
    `${symbol} industry trends 2026`,
    `${symbol} competitive landscape`
  ];
  
  const results = [];
  for (const query of searches) {
    const searchResults = await tavily.search(query, {
      max_results: 3,
      search_depth: 'advanced',
      include_domains: [
        'seekingalpha.com',
        'finance.yahoo.com',
        'bloomberg.com',
        'reuters.com',
        'sec.gov',
        'fda.gov'
      ]
    });
    
    results.push({
      query,
      results: searchResults
    });
  }
  
  return results;
}

export default { researchCatalysts };
```

**Update Phase 2 prompt to use catalyst research:**
```javascript
const catalystResearch = await researchCatalysts(stock.symbol, stock.pathway);

const phase2Prompt = `
...

CATALYST RESEARCH RESULTS:
${JSON.stringify(catalystResearch, null, 2)}

Analyze these search results to identify:
1. Upcoming catalysts with specific dates
2. Potential impact on stock price (quantify if possible)
3. Probability of positive outcome
4. Timeline for catalyst realization

Prioritize catalysts that could drive 2x-3x returns.
`;
```

---

### 8. Enhanced Opus Prompts for Growth Evaluation

**Fix:** Update Phase 2 prompt in `src/opus-screener.js`
```javascript
const phase2Prompt = `
LONG ANALYSIS - DEEP DIVE

For each candidate, evaluate:

1. GROWTH POTENTIAL (CRITICAL)
   - Can this stock 2x-3x over 12-24 months?
   - What's the addressable market size and penetration?
   - Is revenue growth accelerating or decelerating?
   - Are margins expanding (operating leverage)?
   - What's the competitive moat?
   
2. CATALYSTS (USE TAVILY RESULTS PROVIDED)
   For each catalyst, note:
   - Expected date/timeline
   - Potential impact on stock price
   - Probability of success
   
3. FUNDAMENTAL QUALITY
   - P/E, PEG, EV/Sales relative to growth rate
   - Revenue growth: current vs 3-year average
   - Gross margin, operating margin trends
   - Free cash flow generation
   - Balance sheet strength
   - Return on equity
   
4. TECHNICAL SETUP
   - Price action and volume trends
   - Support/resistance levels
   - RSI, MACD signals
   
5. RISK ASSESSMENT
   - What could derail the thesis?
   - Competition, regulatory, execution risks
   
For each stock, assign:
- GROWTH_POTENTIAL: 2x-3x / 50-100% / 20-50% / <20%
- CONFIDENCE: High / Medium / Low
- HOLDING_PERIOD: Days / Weeks / Months / Years
`;
```

---

## PHASE 3: ALLOCATION & MONITORING (Week 3)

### 9. Soft Allocation Targets

**Fix:** Add to Phase 4 prompt
```javascript
const phase4Prompt = `
PORTFOLIO CONSTRUCTION

Target allocation guidelines (flexible based on opportunity quality):
- Fundamental holds (deepValue, cashMachine, qarp, qualityCompounder): 50-70%
- Growth/momentum (highGrowth, inflection, turnaround): 20-40%
- Shorts (overvalued, deteriorating, overextended): 0-20%

You may deviate from these targets if:
1. Opportunity quality strongly favors one category
2. Market conditions favor specific strategies
3. Risk management requires adjustment

Explain any significant deviation from targets in your reasoning.
`;
```

---

### 10. Trade Exit Monitoring Service

**Create:** `src/trade-monitor.js`
```javascript
async function checkExitsDaily() {
  console.log('Checking exit conditions for all open trades...');
  
  // Technical stops (momentum trades)
  await checkTechnicalStops();
  
  // Fundamental stops (buy-and-hold) - quarterly
  await checkFundamentalStops();
  
  // Trailing stops (buy-and-hold)
  await updateTrailingStops();
  
  // Rebalancing (buy-and-hold)
  await checkRebalanceTriggers();
  
  // Time stops (momentum trades)
  await checkTimeStops();
  
  // Squeeze risk (shorts)
  await checkSqueezeRisk();
}

async function checkTechnicalStops() {
  const trades = await db.query(`
    SELECT * FROM trades 
    WHERE status = 'open' 
    AND stop_type = 'technical'
  `);
  
  for (const trade of trades.rows) {
    const quote = await tradier.getQuote(trade.symbol);
    const currentPrice = quote.last || quote.close;
    
    if (trade.action === 'BUY' && currentPrice <= trade.stop_loss) {
      await createExitAlert(trade, 'Technical stop hit', currentPrice);
    } else if (trade.action === 'SHORT' && currentPrice >= trade.stop_loss) {
      await createExitAlert(trade, 'Technical stop hit', currentPrice);
    }
  }
}

async function checkFundamentalStops() {
  // Run quarterly after earnings
  const trades = await db.query(`
    SELECT * FROM trades 
    WHERE status = 'open' 
    AND stop_type = 'fundamental'
  `);
  
  for (const trade of trades.rows) {
    const fundamentals = await fmp.getFundamentals(trade.symbol);
    const conditions = trade.fundamental_stop_conditions;
    
    // Check each condition
    if (conditions.operating_margin_min && fundamentals.operatingMargin < conditions.operating_margin_min) {
      await createExitAlert(trade, `Operating margin ${fundamentals.operatingMargin} < ${conditions.operating_margin_min}`, null);
    }
    
    if (conditions.debt_to_equity_max && fundamentals.debtToEquity > conditions.debt_to_equity_max) {
      await createExitAlert(trade, `Debt/Equity ${fundamentals.debtToEquity} > ${conditions.debt_to_equity_max}`, null);
    }
  }
}

async function updateTrailingStops() {
  const trades = await db.query(`
    SELECT * FROM trades 
    WHERE status = 'open' 
    AND target_type = 'trailing'
  `);
  
  for (const trade of trades.rows) {
    const quote = await tradier.getQuote(trade.symbol);
    const currentPrice = quote.last || quote.close;
    
    // Update peak price if new high
    if (currentPrice > trade.peak_price) {
      const newTrailingStop = currentPrice * (1 - trade.trailing_stop_pct / 100);
      
      await db.query(`
        UPDATE trades 
        SET peak_price = $1, stop_loss = $2 
        WHERE id = $3
      `, [currentPrice, newTrailingStop, trade.id]);
      
      console.log(`Updated trailing stop for ${trade.symbol}: $${newTrailingStop.toFixed(2)}`);
    }
    
    // Check if trailing stop hit
    if (currentPrice <= trade.stop_loss) {
      await createExitAlert(trade, 'Trailing stop hit', currentPrice);
    }
  }
}

export default { checkExitsDaily };
```

**Add to cron:** `src/index.js`
```javascript
// Daily at 4:30 PM ET - Check exit conditions
cron.schedule('30 16 * * 1-5', async () => {
  await tradeMonitor.checkExitsDaily();
}, { timezone: 'America/New_York' });
```

---

## ALREADY IMPLEMENTED (No Action Needed)

### ✅ Earnings Calendar Integration
- **File**: `src/earnings-guard.js`
- **Logic**: Blocks trades 3 days before earnings
- **Post-earnings**: Allows trades 1-3 days after earnings (dip-buy opportunity)
- **Database**: `earnings_calendar` table exists

### ✅ Insider Trading Data
- **API**: FMP has insider trading endpoints
- **Files**: Referenced in `src/fmp.js`, `src/stock-profiles.js`
- **Usage**: Can be enhanced in catalyst research

---

## IMPLEMENTATION CHECKLIST

### Week 1 (Critical)
- [ ] Database migration (trade_approvals schema)
- [ ] Phase 4 output format (momentum vs buy-and-hold)
- [ ] Parser updates (extract new fields)
- [ ] UI updates (comprehensive trade cards)
- [ ] QARP sector-relative P/E
- [ ] Turnaround AND → OR logic
- [ ] HighGrowth sector-relative thresholds
- [ ] Inflection balance sheet relaxation
- [ ] Short pathway split (overvalued vs deteriorating)
- [ ] Short momentum direction by pathway
- [ ] Short float logic flip for deteriorating
- [ ] Momentum bypass implementation

### Week 2 (Growth)
- [ ] Expand stock universe ($1B-$10B growth stocks)
- [ ] Add growth potential scoring function
- [ ] Create catalyst research module
- [ ] Enhanced Opus prompts for growth evaluation
- [ ] Integrate Tavily catalyst research into Phase 2

### Week 3 (Allocation & Monitoring)
- [ ] Add soft allocation targets to Phase 4
- [ ] Create trade exit monitoring service
- [ ] Add daily exit check to cron
- [ ] Test all exit conditions (technical, fundamental, trailing, time, squeeze)

---

## EXPECTED OUTCOMES

**Pathway Distribution After Fixes:**
- qarp: 38 → 20-25 (more selective)
- turnaround: 0 → 5-10 (now working)
- inflection: 4 → 8-10 (catches early inflections)
- highGrowth: 7 → 10-15 (sector-relative, includes small-caps)
- overvalued: 57 → 35-40 (split with deteriorating)
- deteriorating: 0 → 15-20 (new pathway)
- overextended: 0 → 5-10 (to be implemented)

**Total Universe:** 377 → 450-500 stocks (includes small-cap growth)

**Trade Quality:**
- Detailed reasoning for every trade
- Clear stop loss strategy by pathway type
- Proper target price strategy (fixed vs trailing)
- Growth potential explicitly evaluated
- Catalysts researched and documented

**Portfolio Balance:**
- 50-70% fundamental holds (patient capital)
- 20-40% growth/momentum (swing trades)
- 0-20% shorts (opportunistic)

---

## VALIDATION AFTER IMPLEMENTATION

1. Run Saturday fundamental screening
2. Verify pathway stock counts match expectations
3. Run daily analysis (Phase 1-4)
4. Check trade approval queue has detailed reasoning
5. Verify UI displays all new fields correctly
6. Test exit monitoring service
7. Review Opus analysis quality with catalyst research

---

**End of Implementation Plan**
