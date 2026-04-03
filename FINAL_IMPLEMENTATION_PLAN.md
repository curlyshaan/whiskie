# 🎯 Whiskie Bot - Final Implementation Plan

## Based on Claude Opus Deep Analysis + Your Feedback

---

## 1. Investment Philosophy

### Capital Allocation
- **65% Long-term** ($65,000) - Hold 1+ year for tax benefits
- **25% Swing** ($25,000) - Weeks to months
- **10% Cash Reserve** ($10,000) - Add to winners or buy dips

### Position Limits (Dynamic)
- **Normal market**: 8 long-term + 4 swing = 12 positions
- **Opportunity-rich**: Up to 10 long-term + 5 swing = 15 positions
- **Defensive**: Down to 6 long-term + 2 swing = 8 positions

### Position Sizing
- **Long-term**: 6-10% initial, 15% max per position
- **Swing**: 5-8% per trade, 10% max per position
- **Risk per trade**: Max 1.5% of portfolio ($1,500)

---

## 2. Database Schema Changes

### New Table: position_lots
```sql
CREATE TABLE position_lots (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  lot_type VARCHAR(20) NOT NULL,  -- 'long-term', 'swing'
  quantity INTEGER NOT NULL,
  cost_basis DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),
  entry_date DATE NOT NULL,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  oco_order_id VARCHAR(50),
  thesis TEXT,
  trim_level INTEGER DEFAULT 0,  -- 0, 1, 2, 3
  days_held INTEGER DEFAULT 0,
  days_to_long_term INTEGER,  -- Days until 1-year (365 - days_held)
  trailing_stop_active BOOLEAN DEFAULT FALSE,
  last_reviewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_position_lots_symbol ON position_lots(symbol);
CREATE INDEX idx_position_lots_type ON position_lots(lot_type);
```

### Update positions table (keep for aggregation)
```sql
ALTER TABLE positions
ADD COLUMN investment_type VARCHAR(20),  -- 'long-term', 'swing', 'hybrid'
ADD COLUMN total_lots INTEGER DEFAULT 1,
ADD COLUMN long_term_lots INTEGER DEFAULT 0,
ADD COLUMN swing_lots INTEGER DEFAULT 0,
ADD COLUMN thesis TEXT,
ADD COLUMN days_to_long_term INTEGER,
ADD COLUMN next_earnings_date DATE,
ADD COLUMN trim_history JSONB;  -- Track trim events
```

### New Table: earnings_calendar
```sql
CREATE TABLE earnings_calendar (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  earnings_date DATE NOT NULL,
  time_of_day VARCHAR(10),  -- 'bmo' (before market open) or 'amc' (after market close)
  confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, earnings_date)
);

CREATE INDEX idx_earnings_symbol ON earnings_calendar(symbol);
CREATE INDEX idx_earnings_date ON earnings_calendar(earnings_date);
```

---

## 3. Trimming Strategy

### Long-Term Positions (Graduated Trimming)
```javascript
Trim Schedule:
- Entry: 8 shares @ $375 = $3,000
- Trim 1 (+25-30%): Sell 2 shares (25%) @ $469-488
  → Remaining: 6 shares
  → New stop: Breakeven + 7% ($401)
  → New target: +50% ($563)
  
- Trim 2 (+50-60%): Sell 2 shares (25%) @ $563-600
  → Remaining: 4 shares
  → New stop: Entry + 33% ($500)
  → New target: +80% ($675)
  
- Trim 3 (+80-100%): Sell 2 shares (25%) @ $675-750
  → Remaining: 2 shares
  → New stop: Entry + 50% ($563)
  → Let it run with trailing stop (15% trail)
  
- Final 2 shares: Hold indefinitely with 15% trailing stop
```

### Swing Positions (Simple 2-Step)
```javascript
Trim Schedule:
- Entry: 10 shares @ $10 = $100
- Trim 1 (+15%): Sell 5 shares (50%) @ $11.50
  → Remaining: 5 shares
  → New stop: Breakeven ($10)
  → New target: +25% ($12.50)
  
- Trim 2 (+25%): Sell 5 shares (50%) @ $12.50
  → Position closed
  → Profit: +18.75% average
```

### Hybrid Positions (MSFT Example)
```javascript
Entry: 8 shares MSFT @ $375
- 6 shares: Long-term lot (follow long-term trim schedule)
- 2 shares: Swing lot (follow swing trim schedule)

At +15%: Swing lot sells 1 share
At +25%: Swing lot sells 1 share (swing complete)
At +30%: Long-term trims 1.5 shares (25% of 6)
At +50%: Long-term trims 1.5 shares
At +80%: Long-term trims 1.5 shares
Final 1.5 shares: Hold with trailing stop
```

---

## 4. Stop-Loss Strategy

### Initial Stop-Loss
```javascript
Long-term: -12% to -18% (volatility-adjusted)
- Low volatility (VIX < 15): -12%
- Medium volatility (VIX 15-25): -15%
- High volatility (VIX > 25): -18%

Swing: -6% to -10% (tighter)
- Low volatility: -6%
- Medium volatility: -8%
- High volatility: -10%
```

### Trailing Stop Activation
```javascript
Long-term:
- No trailing until +15% gain
- At +15-30%: Move stop to breakeven
- At +30-50%: 15% trailing stop
- At +50%+: 12% trailing stop (tighter)

Swing:
- At +8%: Move stop to breakeven
- At +15%: 10% trailing stop
```

### Tax-Aware Stop-Loss
```javascript
If position is within 45 days of 1-year holding period:
- Calculate tax savings: (gain × 17%)
- Calculate risk: (current_price - stop_loss)
- If tax_savings > risk × 2: Tighten stop by 50% and WAIT
- Flag position for review: "TAX_HOLD_PERIOD"
```

---

## 5. Analysis Schedule

### Daily Analysis (2x per day)

**10:00 AM ET - Morning Analysis**
```javascript
Focus:
1. Check overnight news for all positions
2. Earnings reactions (if any earnings today)
3. Thesis validation for positions with big moves
4. New trade opportunities
5. Update watchlist

Actions:
- Sell if thesis broken
- Add to winners from cash reserve
- New positions if opportunities
```

**3:00 PM ET - Before Close**
```javascript
Focus:
1. Final position check
2. Any urgent sells before close
3. Prepare for after-hours earnings
4. Risk check (any positions too large?)

Actions:
- Trim if needed
- Close swing positions at target
- Adjust stops if needed
```

### Weekly Review (Sunday 9:00 PM ET)

```javascript
Deep Review Process:
1. For EACH position:
   - Fetch latest news (Tavily)
   - Check fundamentals
   - Calculate days held
   - Check if near long-term status (flag if < 45 days)
   
2. Ask Opus for EACH position:
   "Review [SYMBOL]:
   - Entry: $X on [date] ([days] days ago)
   - Current: $Y ([gain]%)
   - Thesis: [original thesis]
   - Recent news: [news summary]
   - Type: [long-term/swing]
   - Days to long-term: [X days]
   
   Questions:
   1. Is thesis still valid?
   2. Should we adjust stop-loss? (current: $Z)
   3. Should we adjust take-profit? (current: $W)
   4. Should we trim now?
   5. Any concerns?"

3. Update OCO orders:
   - Cancel old OCO order
   - Place new OCO order with updated levels
   
4. Check upcoming earnings (next 7 days)
   - Flag positions with earnings this week
   - Decide: hold through or trim before?

5. Portfolio rebalancing:
   - Check if any position > 15% (long-term) or > 10% (swing)
   - Trim if needed
   - Check cash reserve (should be ~10%)

6. Send weekly summary email
```

### Earnings Day Analysis (Special)

**Pre-Market (if earnings before open)**
```javascript
7:00 AM ET:
1. Fetch earnings results
2. Quick Opus analysis:
   - Beat or miss?
   - Guidance change?
   - Thesis impact?
3. Decision:
   - Hold through
   - Sell pre-market
   - Trim 50%
```

**After-Hours (if earnings after close)**
```javascript
5:00 PM ET:
1. Fetch earnings results
2. Quick Opus analysis
3. Prepare action for next morning
4. DO NOT SELL in after-hours (illiquid)
```

**Next Morning (after earnings)**
```javascript
10:00 AM ET:
1. Review overnight price action
2. Full Opus analysis with 30-min price data
3. Decision:
   - Thesis intact + overreaction = HOLD or ADD
   - Thesis broken = SELL
   - Unclear = TRIM 50% and wait
```

---

## 6. Earnings Calendar Integration

### Option 1: Earnings Whispers API (Free tier)
```javascript
// Free: 100 requests/month
// Endpoint: https://api.earningswhispers.com/calendar
// Returns: Symbol, date, time (BMO/AMC), confirmed

async function fetchEarningsCalendar() {
  // Fetch next 30 days of earnings
  // Store in earnings_calendar table
  // Update daily at 6 AM ET
}
```

### Option 2: Alpha Vantage (Free)
```javascript
// Free: 25 requests/day
// Endpoint: EARNINGS_CALENDAR
// Returns: Symbol, date, estimate, actual (after release)

async function fetchEarningsForSymbol(symbol) {
  // Fetch earnings date for specific symbol
  // Cache for 7 days
}
```

### Option 3: Scrape Yahoo Finance (Free, no API key)
```javascript
// Scrape earnings date from Yahoo Finance stock page
// Backup option if APIs fail
// Update weekly during Sunday review
```

**Recommendation**: Use Alpha Vantage (free, reliable) + Yahoo scraping as backup

---

## 7. OCO Order Management

### Placing OCO Orders
```javascript
async function placeOCOOrderSafely(symbol, quantity, stopLoss, takeProfit) {
  try {
    // Place OCO order with Tradier
    const ocoOrder = await tradier.placeOCOOrder(symbol, quantity, stopLoss, takeProfit);
    
    // Store order ID in database
    await db.updatePositionLot(symbol, { oco_order_id: ocoOrder.id });
    
    console.log(`✅ OCO order placed: ${ocoOrder.id}`);
    return ocoOrder;
    
  } catch (error) {
    console.error(`⚠️ Failed to place OCO order: ${error.message}`);
    
    // Fallback: Store SL/TP in database only
    // Bot will check manually during analysis
    await db.updatePositionLot(symbol, { 
      stop_loss: stopLoss,
      take_profit: takeProfit,
      oco_order_id: null  // Flag as manual monitoring needed
    });
    
    return null;
  }
}
```

### Updating OCO Orders (Sunday Review)
```javascript
async function updateOCOOrder(symbol, lotId, newStopLoss, newTakeProfit) {
  try {
    // 1. Get current OCO order ID
    const lot = await db.getPositionLot(lotId);
    
    if (!lot.oco_order_id) {
      // No OCO order, just update database
      await db.updatePositionLot(lotId, {
        stop_loss: newStopLoss,
        take_profit: newTakeProfit
      });
      return;
    }
    
    // 2. Cancel existing OCO order
    await tradier.cancelOrder(lot.oco_order_id);
    console.log(`✅ Canceled old OCO order: ${lot.oco_order_id}`);
    
    // 3. Wait 1 second (let Tradier process cancellation)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. Place new OCO order
    const newOCO = await tradier.placeOCOOrder(
      symbol, 
      lot.quantity, 
      newStopLoss, 
      newTakeProfit
    );
    
    // 5. Update database
    await db.updatePositionLot(lotId, {
      stop_loss: newStopLoss,
      take_profit: newTakeProfit,
      oco_order_id: newOCO.id
    });
    
    console.log(`✅ New OCO order placed: ${newOCO.id}`);
    
  } catch (error) {
    console.error(`❌ Error updating OCO order: ${error.message}`);
    
    // Critical: Send alert email
    await email.sendErrorAlert(error, `OCO update failed for ${symbol}`);
    
    // Fallback: Update database only
    await db.updatePositionLot(lotId, {
      stop_loss: newStopLoss,
      take_profit: newTakeProfit,
      oco_order_id: null  // Flag for manual monitoring
    });
  }
}
```

---

## 8. Tax Optimization

### Track Days to Long-Term Status
```javascript
async function updateDaysHeld() {
  // Run daily at 6 AM ET
  const positions = await db.getAllPositionLots();
  
  for (const lot of positions) {
    const daysHeld = Math.floor((Date.now() - lot.entry_date) / (1000 * 60 * 60 * 24));
    const daysToLongTerm = Math.max(0, 365 - daysHeld);
    
    await db.updatePositionLot(lot.id, {
      days_held: daysHeld,
      days_to_long_term: daysToLongTerm
    });
    
    // Flag if within 45 days of long-term status
    if (daysToLongTerm > 0 && daysToLongTerm <= 45) {
      console.log(`⚠️ ${lot.symbol}: ${daysToLongTerm} days to long-term status`);
    }
  }
}
```

### Tax-Aware Sell Decision
```javascript
async function shouldWaitForLongTerm(lot, currentPrice) {
  if (lot.lot_type !== 'long-term') return false;
  if (lot.days_to_long_term > 45) return false;
  if (lot.days_to_long_term === 0) return false;  // Already long-term
  
  const gain = currentPrice - lot.cost_basis;
  const gainPercent = (gain / lot.cost_basis) * 100;
  
  // Only consider if position is profitable
  if (gainPercent <= 0) return false;
  
  // Calculate tax savings
  const shortTermTax = gain * 0.37;  // Assume 37% short-term rate
  const longTermTax = gain * 0.20;   // 20% long-term rate
  const taxSavings = shortTermTax - longTermTax;  // 17% difference
  
  // Calculate risk (distance to stop-loss)
  const riskAmount = currentPrice - lot.stop_loss;
  const riskPercent = (riskAmount / currentPrice) * 100;
  
  // Decision: Wait if tax savings > 2× risk
  const shouldWait = taxSavings > (riskAmount * 2);
  
  if (shouldWait) {
    console.log(`💰 ${lot.symbol}: Tax savings ($${taxSavings.toFixed(2)}) > 2× risk ($${riskAmount.toFixed(2)})`);
    console.log(`   Waiting ${lot.days_to_long_term} days for long-term status`);
    
    // Tighten stop-loss by 50% to reduce risk while waiting
    const newStopLoss = currentPrice - (riskAmount * 0.5);
    await updateOCOOrder(lot.symbol, lot.id, newStopLoss, lot.take_profit);
  }
  
  return shouldWait;
}
```

---

## 9. Implementation Priority

### Phase 1: Core Infrastructure (Week 1)
1. ✅ Database schema updates (position_lots, earnings_calendar)
2. ✅ Update executeTrade to create lots
3. ✅ Trimming logic
4. ✅ OCO order update functions
5. ✅ Tax tracking (days_held, days_to_long_term)

### Phase 2: Analysis Enhancement (Week 2)
1. ✅ Weekly review function
2. ✅ Earnings calendar integration (Alpha Vantage)
3. ✅ Earnings day analysis
4. ✅ Tax-aware sell decisions
5. ✅ Update prompts for Opus (include lot info)

### Phase 3: Testing & Refinement (Week 3)
1. ✅ Test trimming logic with paper trading
2. ✅ Test OCO order updates
3. ✅ Test earnings day flow
4. ✅ Test tax optimization
5. ✅ Monitor and adjust

---

## 10. Example Trade Flow

### MSFT Hybrid Position (Complete Lifecycle)

**Day 1: Entry**
```
Analysis: Opus recommends MSFT
- Type: HYBRID (6 long-term + 2 swing)
- Entry: $375
- Thesis: Azure growth + AI momentum
- Stop: $337.50 (-10%)
- Target: $468.75 (+25%)

Execution:
1. Buy 8 shares @ $375 = $3,000
2. Create 2 lots in database:
   - Lot 1: 6 shares, type=long-term
   - Lot 2: 2 shares, type=swing
3. Place 2 OCO orders:
   - OCO 1: 6 shares, stop=$337.50, target=$468.75
   - OCO 2: 2 shares, stop=$337.50, target=$431.25 (swing target +15%)
```

**Day 15: Swing Target Hit**
```
Price: $431.25 (+15%)
Tradier executes: Sell 1 share (50% of swing lot) @ $431.25
Remaining swing lot: 1 share
New OCO for swing: stop=$375 (breakeven), target=$468.75 (+25%)
Long-term lot: Unchanged (6 shares)
```

**Day 30: Swing Complete**
```
Price: $468.75 (+25%)
Tradier executes: Sell 1 share (remaining swing) @ $468.75
Swing lot closed: +20% average profit
Long-term lot: 6 shares still held
New OCO for long-term: stop=$401.25 (breakeven+7%), target=$562.50 (+50%)
```

**Day 90: Long-Term Trim 1**
```
Price: $487.50 (+30%)
Sunday review: Opus says "Thesis intact, trim 25%"
Action: Sell 1.5 shares (25% of 6) @ $487.50
Remaining: 4.5 shares
New OCO: stop=$500 (+33%), target=$675 (+80%)
```

**Day 180: Long-Term Trim 2**
```
Price: $600 (+60%)
Sunday review: Opus says "Strong momentum, trim again"
Action: Sell 1.5 shares @ $600
Remaining: 3 shares
New OCO: stop=$562.50 (+50%), target=$750 (+100%)
```

**Day 270: Long-Term Trim 3**
```
Price: $712.50 (+90%)
Sunday review: Opus says "Exceptional performance, trim"
Action: Sell 1.5 shares @ $712.50
Remaining: 1.5 shares
New OCO: stop=$637.50 (+70%), trailing 15%
```

**Day 365+: Long-Term Status Achieved**
```
Price: $800 (+113%)
Tax status: LONG-TERM (held 365+ days)
Action: Hold with 15% trailing stop
If sold now: Pay 20% tax (vs 37% if sold earlier)
Tax savings: $72.25 per share × 1.5 shares = $108.38
```

**Final Results:**
```
Swing lot (2 shares):
- Sold 1 @ $431.25 (+15%)
- Sold 1 @ $468.75 (+25%)
- Average: +20% = $93.75 profit

Long-term lot (6 shares):
- Sold 1.5 @ $487.50 (+30%)
- Sold 1.5 @ $600 (+60%)
- Sold 1.5 @ $712.50 (+90%)
- Hold 1.5 @ $800+ (+113%+)
- Average so far: +73% = $1,095 profit

Total profit: $1,188.75 on $3,000 investment = +39.6%
Still holding: 1.5 shares worth $1,200 (cost basis $562.50)
```

---

## 11. Next Steps

1. **Review this plan** - Any changes needed?
2. **Approve database schema** - Ready to implement?
3. **Choose earnings API** - Alpha Vantage or Earnings Whispers?
4. **Set analysis schedule** - Confirm times (10 AM, 3 PM, Sunday 9 PM)?
5. **Deploy Phase 1** - Start with core infrastructure?

Let me know and I'll start implementing!
