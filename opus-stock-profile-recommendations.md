## Current Field Review & Recommendations

**symbol** (VARCHAR(10))
- **Purpose**: Primary identifier for stock lookup
- **Target length**: 1-10 characters
- **Content guidance**: Standard ticker symbol only

**business_model** (TEXT → VARCHAR(1500))
- **Purpose**: Core revenue streams, customer segments, unit economics
- **Target length**: 800-1200 characters (~150-200 words)
- **Content guidance**: How they make money, key products/services, revenue mix percentages, pricing model. Exclude detailed history or fluff.

**moats** (TEXT → VARCHAR(1200))
- **Purpose**: Durable competitive advantages that protect margins
- **Target length**: 600-1000 characters (~100-150 words)
- **Content guidance**: Network effects, switching costs, brand, scale economies, regulatory barriers. Rate strength (weak/moderate/strong). Exclude generic statements.

**competitive_advantages** (TEXT → VARCHAR(1000))
- **Purpose**: Current tactical advantages vs peers
- **Target length**: 500-800 characters (~80-120 words)
- **Content guidance**: Specific differentiators vs named competitors, market position, operational excellence. Focus on measurable/observable advantages.
- **Note**: Consider merging with moats or renaming to "competitive_position" to reduce overlap

**fundamentals** (JSONB)
- **Purpose**: Key financial metrics for valuation context
- **Recommended structure**:
```json
{
  "market_cap_b": 150.5,
  "revenue_growth_3y": 0.25,
  "gross_margin": 0.42,
  "operating_margin": 0.18,
  "roic": 0.22,
  "debt_to_equity": 0.35,
  "fcf_margin": 0.15,
  "pe_ratio": 28.5,
  "peg_ratio": 1.2,
  "ev_to_sales": 8.5,
  "rule_of_40": 43
}
```
- **Content guidance**: Use trailing 12-month or most recent annual data. Include only metrics relevant to business model.

**risks** (TEXT → VARCHAR(1500))
- **Purpose**: Material downside scenarios for daily monitoring
- **Target length**: 800-1200 characters (~150-200 words)
- **Content guidance**: Rank by probability × impact. Include: execution risks, competitive threats, regulatory, macro sensitivity, balance sheet concerns. Be specific with numbers/thresholds where possible.

**catalysts** (TEXT → VARCHAR(1200))
- **Purpose**: Potential positive drivers for opportunity identification
- **Target length**: 600-1000 characters (~100-150 words)
- **Content guidance**: Near-term (0-6mo) and medium-term (6-18mo) catalysts. Include product launches, margin expansion opportunities, market share gains, multiple re-rating scenarios. Avoid vague "continued growth" statements.

**quality_flag** (VARCHAR(20))
- **Purpose**: Quick filter for profile completeness
- **Recommended values**: 'complete', 'partial', 'needs_refresh', 'low_confidence'
- **Content guidance**: Set based on data availability and research depth

**skip_reason** (TEXT → VARCHAR(500))
- **Purpose**: Document why profile wasn't built/updated
- **Target length**: 100-300 characters
- **Content guidance**: Brief explanation (e.g., "Insufficient public data", "Recent IPO - limited history", "Pending merger")

---

## Recommended NEW Fields

**industry_sector** (VARCHAR(100))
- **Purpose**: Quick classification for sector rotation analysis
- **Content**: Use standard taxonomy (e.g., "Technology - Software", "Healthcare - Biotech")

**market_cap_category** (VARCHAR(20))
- **Purpose**: Size-based filtering and risk assessment
- **Values**: 'mega' (>200B), 'large' (10-200B), 'mid' (2-10B), 'small' (<2B)

**growth_stage** (VARCHAR(30))
- **Purpose**: Lifecycle context for valuation framework
- **Values**: 'hyper_growth', 'growth', 'mature', 'turnaround', 'declining'

**management_quality** (TEXT → VARCHAR(800))
- **Purpose**: Capital allocation and execution track record
- **Target length**: 400-600 characters
- **Content**: CEO tenure, insider ownership %, historical capital allocation decisions, execution on guidance, major strategic wins/misses

**valuation_framework** (TEXT → VARCHAR(1000))
- **Purpose**: Which metrics matter most for THIS stock
- **Target length**: 500-800 characters
- **Content**: Primary valuation method (DCF, comps, sum-of-parts), key multiples to track, normalized earnings power, growth assumptions, what multiple expansion/contraction depends on

**competitive_landscape** (TEXT → VARCHAR(1000))
- **Purpose**: Market structure and positioning context
- **Target length**: 500-800 characters
- **Content**: Market share data, top 3-5 competitors with brief positioning, market concentration, pricing dynamics, barriers to entry for NEW competitors

**key_metrics_to_watch** (JSONB)
- **Purpose**: Stock-specific KPIs for daily news analysis
- **Structure**:
```json
{
  "primary": ["revenue_growth", "gross_margin"],
  "secondary": ["customer_acquisition_cost", "churn_rate"],
  "thresholds": {
    "revenue_growth": {"concern": 0.15, "target": 0.25},
    "gross_margin": {"concern": 0.38, "target": 0.45}
  }
}
```

**last_earnings_date** (DATE)
- **Purpose**: Context for news relevance and next catalyst timing
- **Content**: Most recent earnings report date

**next_earnings_date** (DATE)
- **Purpose**: Upcoming catalyst awareness
- **Content**: Expected next earnings date (update after each report)

**analyst_consensus** (JSONB)
- **Purpose**: Sentiment baseline for contrarian opportunities
- **Structure**:
```json
{
  "rating_distribution": {"buy": 15, "hold": 8, "sell": 2},
  "price_target_avg": 185.50,
  "price_target_range": [150, 220],
  "updated": "2026-04-01"
}
```

**insider_ownership_pct** (NUMERIC(5,2))
- **Purpose**: Alignment indicator
- **Content**: Percentage of shares held by insiders

**institutional_ownership_pct** (NUMERIC(5,2))
- **Purpose**: Liquidity and sentiment indicator
- **Content**: Percentage held by institutions

---

## Structural Improvements

1. **Add NOT NULL constraints** to critical fields: symbol, business_model, moats, risks, last_updated
2. **Add CHECK constraints** for character limits to prevent truncation
3. **Create enum types** for quality_flag, market_cap_category, growth_stage
4. **Add index** on (symbol, profile_version) for fast lookups
5. **Consider partitioning** by quality_flag if you'll have many 'skip' entries

## Implementation Priority

**Phase 1 (Immediate):**
- Add character limits to existing TEXT fields
- Add NOT NULL constraints
- Add: valuation_framework, key_metrics_to_watch, management_quality

**Phase 2 (Next iteration):**
- Add: industry_sector, market_cap_category, growth_stage
- Add: last_earnings_date, next_earnings_date
- Restructure fundamentals JSONB with standard schema

**Phase 3 (Future):**
- Add: competitive_landscape, analyst_consensus
- Add: ownership fields
- Consider splitting into normalized tables if complexity grows