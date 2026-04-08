# Feature 4 - Macro Calendar Awareness (NOT YET IMPLEMENTED)

## Status: DEFERRED FOR MANUAL IMPLEMENTATION

This feature was excluded from the automated implementation because it requires quarterly manual updates of hardcoded dates.

## What It Does

Tracks high-impact economic events (FOMC meetings, CPI reports, NFP, PPI) that can move the entire market 1-3% in a single session. Warns Claude on event days to:
- Tighten stop-losses on affected positions
- Avoid large new entries
- Factor macro risk into recommendations

## Why It Matters

A long position in rate-sensitive stocks (banks, REITs, growth tech) going into a surprise CPI print can get wiped despite a perfect thesis. Knowing these events are coming doesn't mean avoiding all trades — it means sizing down, tightening stops, and factoring macro risk into Claude's recommendations.

## Implementation Approach

**Create new file: `src/macro-calendar.js`**

Contains hardcoded array of macro events:
```javascript
const MACRO_EVENTS = [
  { date: '2026-01-29', type: 'FOMC', name: 'Fed Rate Decision', impact: 'HIGH', description: '...' },
  { date: '2026-01-15', type: 'CPI', name: 'CPI Report', impact: 'HIGH', description: '...' },
  { date: '2026-01-09', type: 'NFP', name: 'Jobs Report (NFP)', impact: 'HIGH', description: '...' },
  // ... more events
];
```

Functions:
- `getUpcomingEvents(daysAhead)` - Get events within N days
- `getTodayEvents()` - Get events happening today
- `buildMacroContext()` - Build context string for Claude's prompt
- `isMacroEventDay()` - Check if today is a macro event day

**Modify `src/index.js`:**
```javascript
import { buildMacroContext, isMacroEventDay } from './macro-calendar.js';

// In runDailyAnalysis(), before building Claude prompt:
const macroContext = buildMacroContext();
if (isMacroEventDay()) {
  console.log('⚠️ MACRO EVENT DAY — Claude will factor this into all recommendations');
}
// Append macroContext to the Claude analysis prompt
```

## Maintenance Required

**QUARTERLY UPDATES NEEDED** - Update `MACRO_EVENTS` array every 3 months by checking:
- FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- CPI: https://www.bls.gov/schedule/news_release/cpi.htm
- NFP: https://www.bls.gov/schedule/news_release/empsit.htm

Takes ~10 minutes every 3 months to copy-paste new dates.

## Why Not Automated

No reliable free API exists for FOMC/CPI/NFP dates. Scraping these sites is fragile (HTML structure changes unpredictably). Hardcoding is more reliable for this use case (~40 events/year, rarely change).

## When to Implement

Implement this feature when you're ready to commit to quarterly manual updates of the event calendar.
