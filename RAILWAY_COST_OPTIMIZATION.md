# Whiskie Railway Cost Optimization

**Goal:** Keep within Railway's $5/month free credit

---

## Current Setup (24/7 Runtime)

- **Compute:** 720 hours/month = ~$4/month
- **PostgreSQL:** ~$2-3/month
- **Total:** ~$6-7/month ❌ (exceeds free tier)

---

## Optimized Setup (Market Hours Only)

### Strategy: Run Only During Trading Hours

**Active Hours:**
- 9:00 AM - 5:00 PM ET (Mon-Fri)
- 8 hours/day × 5 days = 40 hours/week
- ~160 hours/month

**Benefits:**
- **Compute:** 160 hours/month = ~$1/month ✅
- **PostgreSQL:** ~$2/month ✅
- **Total:** ~$3/month ✅ (within free $5 credit)

---

## Implementation

### Option 1: Cron-Based (Recommended)

Bot runs continuously but only analyzes during market hours:

```javascript
// Already implemented in src/index.js
cron.schedule('30 9 * * 1-5', async () => {
  // Morning analysis at 9:30 AM ET
  await this.runDailyAnalysis();
}, { timezone: 'America/New_York' });

cron.schedule('30 16 * * 1-5', async () => {
  // Evening summary at 4:30 PM ET
  await this.sendDailySummary();
}, { timezone: 'America/New_York' });
```

**Current behavior:** Bot stays running 24/7 but only does work at scheduled times.

**Cost:** ~$4/month (always running)

### Option 2: Railway Cron Jobs (Coming Soon)

Railway is adding native cron job support. When available:
- Bot only runs at scheduled times
- Shuts down between runs
- **Cost:** ~$0.50/month

### Option 3: External Cron Trigger

Use a free service (like cron-job.org) to wake up Railway:

1. Create a `/health` endpoint in bot
2. Set up external cron to ping it at 9:30 AM ET
3. Bot runs analysis and shuts down
4. **Cost:** ~$1/month

---

## Recommended Approach

**For Now:** Deploy as-is (24/7)
- **Cost:** ~$6-7/month
- Exceeds free tier by ~$1-2/month
- Railway will charge the overage

**Why it's okay:**
- You're managing $100k (even paper money)
- $1-2/month overage is negligible
- Bot never misses market open
- Simpler setup

**Future:** When Railway adds cron jobs, switch to that
- **Cost:** ~$0.50/month
- Fully within free tier

---

## Alternative: Reduce Database Costs

### Use Railway's Shared PostgreSQL
- Free tier includes shared Postgres
- Limited to 100MB storage
- Should be enough for Whiskie (trades are small)

### Or Use SQLite
- No separate database cost
- File-based (stored with app)
- **Saves ~$2/month**

---

## My Recommendation

**Deploy as-is and pay the $1-2/month overage:**

**Pros:**
- Bot runs 24/7 (reliable)
- Never misses market open
- Simple setup
- Total cost: ~$32-34/month (Claude + Railway)

**Cons:**
- Exceeds free tier by $1-2/month

**Alternative:** If you want to stay 100% free:
1. Switch to SQLite (saves $2/month)
2. Optimize bot to sleep between cron jobs
3. Total: ~$3/month (within free $5 credit)

---

## Decision Time

**Option A:** Deploy now, pay ~$1-2/month overage (recommended)
**Option B:** I optimize for free tier first (takes 15 min)

Which do you prefer?
