# Reset Paper Trading & Fix Email Notifications

## 🔄 Step 1: Reset Paper Trading Account

### Option A: Run Script on Railway (Recommended)

1. **Push the reset script to GitHub:**
   ```bash
   git add reset_paper_trading.js
   git commit -m "Add paper trading reset script"
   git push origin main
   ```

2. **SSH into Railway and run:**
   ```bash
   # In Railway dashboard, open Shell and run:
   node reset_paper_trading.js
   ```

### Option B: Manual Database Reset

Run these SQL commands in Railway's PostgreSQL console:

```sql
-- Delete all trades and positions
DELETE FROM trades;
DELETE FROM positions;
DELETE FROM portfolio_snapshots;
DELETE FROM alerts;
DELETE FROM pending_approvals;

-- Optional: Delete old AI decisions with inaccurate prices
DELETE FROM ai_decisions WHERE created_at < '2025-01-01';

-- Verify reset
SELECT COUNT(*) FROM trades;
SELECT COUNT(*) FROM positions;
```

---

## 📧 Step 2: Fix Email Notifications

### Check Railway Environment Variables

Make sure these are set in Railway dashboard:

```
EMAIL_USER=shanoorsai@gmail.com
EMAIL_PASS=vhatxgdcnzrcyile
ALERT_EMAIL=shanoorsai@gmail.com
```

### Test Email Configuration

1. **Create test script:**
   ```bash
   # Already created: test_email.js
   ```

2. **Run on Railway:**
   ```bash
   node test_email.js
   ```

3. **Check your inbox** for test email

### Common Email Issues

**Issue 1: Gmail App Password Invalid**
- Go to: https://myaccount.google.com/apppasswords
- Generate new app password
- Update `EMAIL_PASS` in Railway

**Issue 2: Less Secure Apps Blocked**
- Gmail may block nodemailer
- Solution: Use App Password (not regular password)

**Issue 3: Email Sent But Not Received**
- Check spam folder
- Check Gmail filters
- Verify `ALERT_EMAIL` is correct

---

## 🔍 Step 3: Verify Email is Being Called

Check Railway logs for:
```
📧 Confirmation email sent
```

If you see this, email was attempted. If not, the code didn't reach that point.

### Debug: Check Trade Execution Flow

In `src/index.js` around line 740:
```javascript
// Send email notification AFTER execution
await email.sendTradeConfirmation({
  action: 'buy',
  symbol: rec.symbol,
  quantity: rec.quantity,
  price: rec.entryPrice,
  stopLoss: rec.stopLoss,
  takeProfit: rec.takeProfit,
  reasoning: rec.reasoning
});

console.log(`   📧 Confirmation email sent`);
```

If you don't see "📧 Confirmation email sent" in logs, the email call failed.

---

## 🧪 Step 4: Test Email Manually

Create `test_email.js`:

```javascript
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

async function testEmail() {
  console.log('Testing email configuration...');
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('ALERT_EMAIL:', process.env.ALERT_EMAIL);
  console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***SET***' : 'NOT SET');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"Whiskie Bot" <${process.env.EMAIL_USER}>`,
      to: process.env.ALERT_EMAIL,
      subject: '✅ Whiskie Email Test',
      html: `
        <h2>Email Configuration Test</h2>
        <p>If you're reading this, email alerts are working correctly! 🎉</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    console.error('Full error:', error);
  }
}

testEmail();
```

Run on Railway:
```bash
node test_email.js
```

---

## 📋 Complete Reset Checklist

- [ ] **Reset Database**
  - [ ] Delete all trades
  - [ ] Delete all positions
  - [ ] Delete portfolio snapshots
  - [ ] Verify counts are 0

- [ ] **Verify Environment Variables**
  - [ ] EMAIL_USER set in Railway
  - [ ] EMAIL_PASS set in Railway
  - [ ] ALERT_EMAIL set in Railway

- [ ] **Test Email**
  - [ ] Run test_email.js
  - [ ] Check inbox for test email
  - [ ] Check spam folder if not received

- [ ] **Deploy Latest Code**
  - [ ] Commit all changes
  - [ ] Push to GitHub
  - [ ] Verify Railway deployment succeeds

- [ ] **Monitor Next Analysis**
  - [ ] Check logs for trade execution
  - [ ] Check logs for "📧 Confirmation email sent"
  - [ ] Check inbox for trade confirmation

---

## 🚀 Quick Commands

### Reset Everything
```bash
# On Railway Shell:
node reset_paper_trading.js
```

### Test Email
```bash
# On Railway Shell:
node test_email.js
```

### Check Recent Trades
```bash
# On Railway PostgreSQL console:
SELECT * FROM trades ORDER BY executed_at DESC LIMIT 5;
```

### Check Email Logs
```bash
# In Railway logs, search for:
"Email sent"
"Email error"
"Confirmation email sent"
```

---

## 🎯 Expected Behavior After Reset

1. **Portfolio**: $100,000 cash, 0 positions
2. **Next Analysis**: Will identify stocks and potentially execute trades
3. **Email**: Should receive confirmation within 1 minute of trade execution
4. **Dashboard**: Should show updated portfolio immediately

---

## ⚠️ If Email Still Doesn't Work

### Alternative: Use SendGrid or Mailgun

If Gmail continues to block, switch to a transactional email service:

**SendGrid** (Free tier: 100 emails/day)
```javascript
// In email.js, replace transporter with:
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
```

**Mailgun** (Free tier: 5,000 emails/month)
```javascript
// In email.js, replace transporter with:
const mailgun = require('mailgun-js')({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN
});
```

---

## 📞 Need Help?

If issues persist:
1. Check Railway logs for exact error messages
2. Verify Gmail App Password is correct
3. Try test_email.js to isolate the issue
4. Check if Gmail is blocking the login attempt
