# Sector Allocation Fix - Design Document

## Problem Analysis

The sector allocation validation is failing because:

1. **VIX regime adjusts position sizes AFTER sector validation**
   - Sector check uses original trade size (e.g., 6.5% of portfolio)
   - VIX multiplier (0.75 for ELEVATED) is applied later
   - Result: Sector check sees 28.5% when actual deployment would be 21.4%

2. **Multiple trades in same sector compound the error**
   - NVDA (6.5%) + AMD (6.1%) + TSM (6.1%) = 18.7% in Semiconductors
   - But sector check adds them as if they're full size
   - With VIX adjustment: 4.9% + 4.6% + 4.6% = 14.0% (well under 30%)

3. **Technology sector includes MSFT, GOOGL, AMZN**
   - These are classified as "Technology" not "Semiconductors"
   - But they're being grouped together incorrectly

## Root Cause

The `validateAndAdjustSectorAllocation()` function in `src/index.js` doesn't:
- Apply VIX regime multipliers before calculating sector totals
- Properly distinguish between sub-sectors (Semiconductors vs Technology)
- Account for existing positions when calculating "after trades" allocation

## Solution Design

### Step 1: Apply VIX Adjustment BEFORE Sector Validation

```javascript
// In src/index.js - before validateAndAdjustSectorAllocation()

// Get VIX regime
const regime = await vixRegime.getRegime();

// Apply VIX multiplier to all trade quantities
for (const trade of recommendations) {
  const originalQuantity = trade.quantity;
  const tradeValue = originalQuantity * trade.price;
  const originalPositionSize = tradeValue / portfolio.totalValue;
  
  // Apply VIX multiplier
  const adjustedPositionSize = originalPositionSize * regime.positionSizeMultiplier;
  const adjustedQuantity = Math.floor((adjustedPositionSize * portfolio.totalValue) / trade.price);
  
  trade.quantity = adjustedQuantity;
  trade.vixAdjusted = true;
  trade.originalQuantity = originalQuantity;
  
  console.log(`VIX adjustment for ${trade.symbol}: ${originalQuantity} → ${adjustedQuantity} shares (${regime.name} regime)`);
}
```

### Step 2: Fix Sector Grouping

Ensure proper sector classification:
- Semiconductors: NVDA, AMD, TSM, AVGO, MRVL, KLAC
- Technology: MSFT, GOOGL, META, AMZN (cloud/software)
- Cybersecurity: CRWD, PANW, ZS, FTNT

### Step 3: Calculate Sector Allocation Correctly

```javascript
async validateAndAdjustSectorAllocation(recommendations, portfolio) {
  const MAX_SECTOR_ALLOCATION = 0.30;
  
  // Calculate current sector allocation from existing positions
  const currentSectorAllocation = {};
  for (const position of portfolio.positions) {
    const sector = position.sector || 'Unknown';
    const positionValue = position.quantity * position.currentPrice;
    currentSectorAllocation[sector] = (currentSectorAllocation[sector] || 0) + positionValue;
  }
  
  // Group trades by sector
  const tradesBySector = {};
  for (const trade of recommendations) {
    const sector = trade.sector || 'Unknown';
    if (!tradesBySector[sector]) {
      tradesBySector[sector] = [];
    }
    tradesBySector[sector].push(trade);
  }
  
  // Validate each sector
  const approvedTrades = [];
  
  for (const [sector, trades] of Object.entries(tradesBySector)) {
    const currentSectorValue = currentSectorAllocation[sector] || 0;
    const currentSectorPct = currentSectorValue / portfolio.totalValue;
    
    // Calculate total new trade value for this sector
    const newTradeValue = trades.reduce((sum, t) => sum + (t.quantity * t.price), 0);
    const afterTradesPct = (currentSectorValue + newTradeValue) / portfolio.totalValue;
    
    console.log(`\n  ${sector}:`);
    console.log(`    Current: ${(currentSectorPct * 100).toFixed(1)}%`);
    console.log(`    After trades: ${(afterTradesPct * 100).toFixed(1)}%`);
    
    if (afterTradesPct <= MAX_SECTOR_ALLOCATION) {
      console.log(`    ✅ All ${trades.length} trades fit within 30% limit`);
      approvedTrades.push(...trades);
    } else {
      // Sector would exceed limit - need to adjust
      const availableRoom = (MAX_SECTOR_ALLOCATION * portfolio.totalValue) - currentSectorValue;
      console.log(`    ⚠️ Sector would exceed 30% limit. Available room: $${availableRoom.toFixed(0)}`);
      
      // Sort trades by conviction (use original quantity as proxy)
      trades.sort((a, b) => (b.originalQuantity || b.quantity) - (a.originalQuantity || a.quantity));
      
      // Fit as many trades as possible
      let usedRoom = 0;
      for (const trade of trades) {
        const tradeValue = trade.quantity * trade.price;
        if (usedRoom + tradeValue <= availableRoom) {
          approvedTrades.push(trade);
          usedRoom += tradeValue;
          console.log(`    ✅ Approved ${trade.symbol} ($${tradeValue.toFixed(0)})`);
        } else {
          console.log(`    ❌ Skipped ${trade.symbol} (would exceed limit)`);
        }
      }
    }
  }
  
  console.log(`\n  Final: ${approvedTrades.length} trades approved (${recommendations.length - approvedTrades.length} skipped/adjusted)`);
  
  return approvedTrades;
}
```

## Test Scenario

Using MSFT, META, AMZN as same sector (Technology):

**Portfolio:**
- Total Value: $114,259.68
- Cash: $89,189.60
- Existing positions: 3 (GLD, LMT, SPY) - none in Technology sector

**Trades (before VIX adjustment):**
1. MSFT: 20 shares @ $374.33 = $7,487 (6.6% of portfolio)
2. META: 15 shares @ $450.00 = $6,750 (5.9% of portfolio)
3. AMZN: 31 shares @ $221.25 = $6,859 (6.0% of portfolio)

**Total Technology sector: $21,096 = 18.5% of portfolio**

**With VIX ELEVATED (0.75 multiplier):**
1. MSFT: 15 shares @ $374.33 = $5,615 (4.9% of portfolio)
2. META: 11 shares @ $450.00 = $4,950 (4.3% of portfolio)
3. AMZN: 23 shares @ $221.25 = $5,089 (4.5% of portfolio)

**Total Technology sector: $15,654 = 13.7% of portfolio ✅ Under 30% limit**

## Implementation Order

1. Apply VIX adjustment to trade quantities FIRST
2. Then validate sector allocation with adjusted quantities
3. Execute trades with VIX-adjusted quantities
4. Log both original and adjusted quantities for transparency
