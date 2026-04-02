# Whiskie Runtime Optimization

**Goal:** Run only during trading hours to minimize Railway costs

---

## Optimized Schedule

### Bot Active Hours (Mon-Fri)
- **9:00 AM - 5:00 PM ET** (8 hours/day)
- **40 hours/week**
- **~160 hours/month**

### What Happens:

**9:00 AM ET:**
- Bot starts (Railway wakes it up)
- Checks if trading hours
- Runs initial portfolio analysis

**9:30 AM ET:**
- Daily analysis (cron job)
- Checks positions
- Sends trade recommendations

**4:30 PM ET:**
- End-of-day summary (cron job)
- Sends email report

**4:35 PM ET:**
- Bot shuts down automatically
- Saves compute costs

**Weekends:**
- Bot checks time and immediately sleeps
- No compute usage

---

## Cost Savings

### Before (24/7):
- 720 hours/month
- ~$4/month compute
- ~$2-3/month database
- **Total: ~$6-7/month**

### After (Trading Hours Only):
- 160 hours/month
- ~$1/month compute ✅
- ~$2/month database
- **Total: ~$3/month** ✅

**Savings: ~$3-4/month** (stays within free $5 credit)

---

## How It Works

1. **Railway restarts bot daily** (or on deploy)
2. **Bot checks current time** (is it 9 AM - 5 PM ET, Mon-Fri?)
3. **If yes:** Run analysis, schedule cron jobs
4. **If no:** Sleep and check again in 1 hour
5. **At 4:35 PM:** Auto-shutdown to save costs

---

## Railway Configuration

Railway will automatically restart the bot when needed. No special configuration required.

**Environment Variable (optional):**
```
AUTO_SHUTDOWN=true  # Enable auto-shutdown after market close
```

---

## Benefits

✅ **Saves ~$3-4/month** (stays in free tier)  
✅ **Never misses market open** (starts at 9 AM)  
✅ **Runs all day during trading hours** (monitors positions)  
✅ **Auto-shuts down** (no wasted compute)  
✅ **Weekends off** (no unnecessary runs)

---

## Testing

```bash
# Test during trading hours (9 AM - 5 PM ET, Mon-Fri)
NODE_ENV=paper node src/index.js
# Should run normally

# Test outside trading hours
NODE_ENV=paper node src/index.js
# Should say "Outside trading hours" and sleep
```

---

**Result:** Bot runs only when needed, saves costs, stays within Railway free tier! 🎉
