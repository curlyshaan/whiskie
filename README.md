# Whiskie - AI Portfolio Manager

Autonomous trading bot powered by Claude Opus with extended thinking. Manages a $100k portfolio using a 4-phase analysis system, stock profiles, and dynamic risk management.

## Quick Start

```bash
npm install
cp .env.example .env  # Configure environment variables
npm start
```

## Documentation

See **[DOCS.md](DOCS.md)** for complete system documentation including:
- 4-phase analysis system
- Stock profile system (biweekly deep research)
- Cron schedule
- Database schema
- API endpoints
- Deployment guide
- Troubleshooting

## Key Features

- **4-Phase Opus Analysis**: Pre-ranking → Long → Short → Portfolio Construction
- **Stock Profile System**: Biweekly deep research, incremental daily updates
- **Trade Approval Queue**: Manual review before execution
- **Long/Short Equity**: 0-3 stocks per sub-sector, market regime adaptation
- **Risk Management**: VIX regime, correlation analysis, sector limits

## Architecture

- **AI**: Claude Opus with extended thinking (50k tokens per phase)
- **Data**: FMP (3-key rotation), Yahoo Finance, Tradier, Tavily
- **Database**: PostgreSQL on Railway
- **Deployment**: Railway with auto-deploy from main branch

## Manual Triggers

```bash
# Trigger biweekly deep research
curl -X POST https://whiskie-production.up.railway.app/api/trigger-deep-research

# Trigger weekly review
curl -X POST https://whiskie-production.up.railway.app/trigger-weekly-review
```

---

**⚠️ Disclaimer:** Paper trading mode by default. Understand the strategy before deploying with real money.
