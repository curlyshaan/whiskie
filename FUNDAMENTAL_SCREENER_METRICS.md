# Fundamental Screener Metrics

Current pathway reference for `src/fundamental-screener.js`.

This document is intentionally aligned to the live code rather than older design notes.
If this file and the code ever diverge, the code wins.

## Current role in the system

The screener runs against active names in `stock_universe` and writes passing candidates to `saturday_watchlist`.

Current weekly flow:

1. Saturday screening inserts candidates with `status='pending'`
2. Sunday weekly Opus review analyzes pending rows
3. The top `7` per pathway become `status='active'`

## Shared baseline filters

These filters apply before or around pathway scoring.

### General baseline

- minimum price: `$5`
- minimum dollar volume: `$5M`

### Average-volume gates

- longs require at least `250k` average shares/day
- shorts require at least `500k` average shares/day

### Short-specific baseline

- minimum market cap: `$2B`
- minimum dollar volume: `$20M`
- max short float for `overvalued` / `overextended`: `15%`
- `deteriorating` can still pass with elevated short float, but the screener annotates it as consensus risk

## Current thresholds

- `LONG_THRESHOLD = 48`
- `SHORT_THRESHOLD = 65`

These are the live constants in the current code.

## Pathway-specific market-cap floors

Current long-side minimums:

- `deepValue`: `$2B`
- `cashMachine`: `$2B`
- `qarp`: `$2B`
- `qualityCompounder`: `$2B`
- `highGrowth`: `$500M`
- `inflection`: `$500M`
- `turnaround`: `$500M`

Current short-side minimum:

- all shorts: `$2B`

## Long pathways

## 1. `deepValue`

Goal: cheap stocks with enough quality to avoid obvious value traps.

### Hard gates

- market cap must be at least `$2B`
- reject if revenue growth is below `-10%`
- reject if accrual ratio is above `12%`
- require at least **2 of 3** value signals:
  - attractive PEG vs sector range
  - attractive P/E vs sector range
  - positive FCF per share
- require a quality floor of at least `25` points
- require at least **3 quality signals** across profitability, leverage, liquidity, ROIC, or dividend support

### Main scoring drivers

- PEG vs sector ideal/high range
- P/E vs sector low/mid range
- positive FCF per share
- low debt
- ROIC above `15%`
- strong quick ratio
- dividend yield above `3%`

## 2. `highGrowth`

Goal: sector-relative revenue growth with enough quality to avoid single-metric growth traps.

### Hard gates

- market cap must be at least `$500M`
- reject if accrual ratio is above `12%`
- apply accrual penalties between `8%-12%`
- apply debt penalties for `D/E > 1.5` and `D/E > 2.0`
- require at least `20` quality/balance-sheet points

### Main scoring drivers

- sector-relative revenue growth tiers
- earnings growth
- operating margin quality
- low debt bonus
- Q-over-Q revenue acceleration
- forward PEG when available, otherwise trailing PEG

## 3. `inflection`

Goal: improving businesses where multiple signals are turning at once.

### Hard gates

- market cap must be at least `$500M`
- reject if accrual ratio is above `12%`
- require at least **2** of these 4 signal groups:
  - revenue acceleration
  - margin expansion
  - FCF growth
  - reasonable PEG
- require a balance-sheet score of at least `10`

### Main scoring drivers

- Q-over-Q revenue acceleration
- Q-over-Q operating-margin expansion
- fast FCF growth
- PEG below `3.0`
- debt and liquidity support

## 4. `cashMachine`

Goal: high free-cash-flow names where cash generation is real, not just optically cheap.

### Hard gates

- market cap must be at least `$2B`
- reject if revenue is below `-5%` and FCF growth is not above `10%`
- reject if accrual ratio is above `12%`
- require at least `20` quality/balance-sheet points
- require at least **3** active category signals across:
  - FCF yield
  - FCF growth
  - efficiency
  - balance sheet

### Main scoring drivers

- FCF yield (`>= 10%`, `>= 8%`, `>= 5%` tiers)
- FCF growth, especially when faster than revenue growth
- low debt
- ROIC above `20%`
- favorable cash conversion cycle
- attractive price-to-operating-cash-flow multiple

## 5. `qarp`

Goal: quality at a reasonable price.

### Hard gates

- market cap must be at least `$2B`
- reject if P/E is above the pathway's sector-aware ceiling
- reject if accrual ratio is above `12%`
- require scoring in at least **3 of 4** buckets:
  - quality
  - valuation
  - growth
  - balance

### Main scoring drivers

- ROIC above `15%` or `20%`
- ROE above `20%`
- reasonable P/E range
- reasonable trailing PEG
- positive earnings growth
- low debt
- asset turnover bonus

## 6. `qualityCompounder`

Goal: high-quality compounders during temporary earnings softness, not structural deterioration.

### Hard gates

- market cap must be at least `$2B`
- `ROE > 20%`
- `ROIC > 15%`
- `operating margin > 20%`
- Q-over-Q operating-margin change must be at least `-2%`
- `D/E < 0.5`
- if interest coverage is present, it must be at least `5x`
- revenue growth must be above `8%`
- earnings growth must fall between `-8%` and `+5%`
- valuation must satisfy `P/E < 35` **or** `PEG < 3.0`
- reject if accrual ratio is above `12%`

### Main scoring drivers

- ROE tiers above `20%` / `25%`
- ROIC tiers above `15%` / `20%`
- operating-margin tiers above `20%` / `25%`
- Q-over-Q margin expansion bonus
- revenue growth above `8%` / `12%`
- lower debt
- strong quick ratio
- temporary earnings dip annotation

## 7. `turnaround`

Goal: improving special situations with early signs of operational or financial recovery.

### Hard gates

- market cap must be at least `$500M`
- reject if `D/E > 2.0`
- current code requires **at least one side** of the turnaround to clear its floor:
  - operational score `>= 15`, or
  - financial score `>= 12`

### Main scoring drivers

- manageable debt
- operating-margin improvement
- revenue stabilization or renewed growth
- positive FCF with strong FCF growth
- adequate quick ratio
- improving working-capital collection (`daysOfSalesOutstanding`)
- P/E below `20`

## Short logic

Short candidates must satisfy **all** of the following:

1. valuation score `>= 20`
2. deterioration score `>= 20`
3. short safety check passes
4. total score `>= 65`

### Valuation scoring

Current signals include:

- sector-relative extreme P/E
- PEG or forward PEG overvaluation
- negative PEG + premium P/E combinations
- EV/EBITDA above `40`
- at least **2 valuation extremes** are required

### Deterioration scoring

Current signals include:

- revenue deceleration
- margin compression
- FCF decline
- negative earnings growth combined with high P/E

### Safety rules

- market cap must be at least `$2B`
- dollar volume must be at least `$20M`
- `overvalued` and `overextended` reject on short float above `15%`
- `deteriorating` can survive higher short float but gets annotated for consensus/squeeze context

### Pathway label assignment

Current short labels are assigned after scoring:

- `deteriorating` when deterioration clearly dominates valuation
- `overvalued` when valuation dominates
- `overextended` in extreme stretched-multiple cases

## Watchlist output behavior

### On Saturday

The screener:

- expires existing `active` / `pending` rows
- inserts new long and short rows into `saturday_watchlist`
- uses `status='pending'`

### On Sunday

`src/weekly-opus-review.js`:

- reviews pending rows by pathway
- analyzes the top `20` names per pathway
- activates the top `7` per pathway

## Data inputs used by the screener

Current inputs come from `src/fmp.js`, Tradier, and related helper logic.

### FMP-derived data

The scorer uses metrics such as:

- P/E
- trailing PEG and forward PEG
- operating margin
- ROE
- ROIC
- EV/EBITDA
- debt-to-equity
- free cash flow and FCF growth
- revenue and earnings growth
- quarterly revenue/margin comparisons
- liquidity ratios
- short float and other quality signals where available

### Tradier-derived data

The screener uses live quote information for:

- price
- volume
- dollar-volume calculations

## Rate limiting and batching

Current screening behavior:

- stocks are processed in batches of `5`
- there is a `10-second` delay between batches
- `src/fmp.js` uses controlled parallel quote fan-out and a `30-minute` in-memory cache

## Notes on source of truth

This document replaces older screener writeups that still mention:

- `6` long pathways
- lower thresholds such as `35`, `38`, `50`, or `55`
- no-cache FMP behavior
- top-15 Sunday activation
- uniform universe counts like `365`, `377`, or `407`

Those older references should be treated as historical context only.
