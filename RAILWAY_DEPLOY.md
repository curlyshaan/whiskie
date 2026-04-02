# Railway Deployment Guide for Whiskie

## Step 1: Create New Railway Project

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Select `curlyshaan/whiskie`
4. Railway will auto-detect the configuration

## Step 2: Add PostgreSQL Database

1. In your Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will automatically create `DATABASE_URL` variable

## Step 3: Set Environment Variables

Add these in Railway project settings → Variables:

```
NODE_ENV=paper

# Claude API
QUATARLY_API_KEY=qua-13iwudxg7brvd4quvuofuockowsmj4cl
QUATARLY_BASE_URL=https://api.quatarly.cloud/

# Tradier Sandbox (Paper Trading)
TRADIER_SANDBOX_API_KEY=RKNlRZPHldC7KsklU6d586wqJGV1
TRADIER_SANDBOX_ACCOUNT_ID=VA43247024
TRADIER_BASE_URL=https://api.tradier.com/v1
TRADIER_SANDBOX_URL=https://sandbox.tradier.com/v1

# Tradier Live (for future)
TRADIER_API_KEY=NzqeofwwmWK94Adi2E9rghG33mKZ
TRADIER_ACCOUNT_ID=6YB76407

# Tavily API
TAVILY_API_KEY=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
TAVILY_MONTHLY_LIMIT=1000
TAVILY_ALERT_THRESHOLD=900

# Email
EMAIL_USER=shanoorsai@gmail.com
EMAIL_PASS=vhatxgdcnzrcyile
ALERT_EMAIL=shanoorsai@gmail.com

# Risk Limits
MAX_POSITION_SIZE=0.15
MAX_DAILY_TRADES=3
MAX_PORTFOLIO_DRAWDOWN=0.20
MIN_CASH_RESERVE=0.03
MAX_SECTOR_ALLOCATION=0.25

# Portfolio
INITIAL_CAPITAL=100000
```

## Step 4: Deploy

Railway will automatically:
1. Build the project
2. Install dependencies
3. Start the bot
4. Run daily at 9:30 AM ET

## Step 5: Monitor

Check Railway logs to see:
- Bot startup
- Daily analysis
- Trade recommendations
- Email alerts

## Important Notes

- Bot runs in **PAPER TRADING** mode (no real money)
- Trades execute on Tradier sandbox ($100k paper money)
- Email alerts sent before every trade
- Database tracks all trades and decisions
- Cron jobs run automatically (9:30 AM and 4:30 PM ET)

## To Switch to Live Trading

1. Change `NODE_ENV=production` in Railway
2. Bot will use live Tradier account
3. **Test thoroughly in paper mode first!**
