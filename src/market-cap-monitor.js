import * as db from './db.js';
import fmp from './fmp.js';
import email from './email.js';

/**
 * Market Cap Monitor
 * Alerts when positions drop below 7B market cap threshold
 */

const MIN_MARKET_CAP = 7_000_000_000; // 7B

/**
 * Check all positions for market cap drops below threshold
 */
export async function checkPositionMarketCaps() {
  console.log('💰 Checking position market caps...');

  try {
    const positions = await db.query(
      'SELECT symbol, quantity, position_type FROM positions WHERE quantity != 0'
    );

    if (positions.rows.length === 0) {
      console.log('   No positions to check');
      return { checked: 0, alerts: [] };
    }

    const alerts = [];

    for (const position of positions.rows) {
      try {
        // Fetch current profile from FMP
        const profile = await fmp.getProfile(position.symbol);

        if (!profile || !profile.marketCap) {
          console.warn(`   ⚠️ No market cap data for ${position.symbol}`);
          continue;
        }

        const marketCapB = profile.marketCap / 1e9;

        // Update position with current market cap
        await db.query(
          'UPDATE positions SET current_market_cap = $1 WHERE symbol = $2',
          [profile.marketCap, position.symbol]
        );

        // Check if below threshold
        if (profile.marketCap < MIN_MARKET_CAP) {
          const alert = {
            symbol: position.symbol,
            marketCap: profile.marketCap,
            marketCapB: marketCapB.toFixed(2),
            positionType: position.position_type,
            quantity: position.quantity
          };

          alerts.push(alert);

          console.log(`   🚨 ${position.symbol}: $${marketCapB.toFixed(2)}B (below $7B threshold)`);

          // Create alert in database
          await db.query(
            `INSERT INTO alerts (alert_type, symbol, message, severity, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              'market_cap_drop',
              position.symbol,
              `Market cap dropped to $${marketCapB.toFixed(2)}B (below $7B threshold). Consider selling.`,
              'warning'
            ]
          );
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 400));

      } catch (error) {
        console.error(`   ❌ Error checking ${position.symbol}:`, error.message);
      }
    }

    if (alerts.length > 0) {
      await sendMarketCapAlert(alerts);
    }

    console.log(`   ✅ Checked ${positions.rows.length} positions, ${alerts.length} alerts`);

    return {
      checked: positions.rows.length,
      alerts
    };

  } catch (error) {
    console.error('❌ Error checking market caps:', error);
    throw error;
  }
}

/**
 * Send email alert for market cap drops
 */
async function sendMarketCapAlert(alerts) {
  try {
    let html = `
      <h2>⚠️ Market Cap Alert</h2>
      <p>The following positions have dropped below the $7B market cap threshold:</p>
      <table style="border-collapse: collapse; width: 100%;">
        <tr style="background: #f5f5f5;">
          <th style="padding: 8px; border: 1px solid #ddd;">Symbol</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Market Cap</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Position Type</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Quantity</th>
        </tr>
    `;

    alerts.forEach(alert => {
      html += `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${alert.symbol}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">$${alert.marketCapB}B</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${alert.positionType}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${alert.quantity}</td>
        </tr>
      `;
    });

    html += `
      </table>
      <p><strong>Recommendation:</strong> Consider selling these positions as they no longer meet the $7B minimum market cap requirement.</p>
    `;

    await email.sendEmail('⚠️ Market Cap Alert - Positions Below $7B', html);

  } catch (error) {
    console.error('Error sending market cap alert:', error);
  }
}

export default {
  checkPositionMarketCaps
};
