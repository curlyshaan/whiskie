import axios from 'axios';
import * as cheerio from 'cheerio';
import * as db from './db.js';
import fmp from './fmp.js';
import tavily from './tavily.js';
import claude, { MODELS } from './claude.js';
import { resolveMarketPrice } from './utils.js';

const EASTERN_TIMEZONE = 'America/New_York';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function getEasternDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day)
  };
}

function easternDateToUtcDate(year, month, day, hour = 15, minute = 0, second = 0) {
  const approximate = new Date(Date.UTC(year, month - 1, day, hour + 5, minute, second));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(approximate).map(part => [part.type, part.value])
    );

    const targetMinutes = (((hour * 60) + minute) * 60) + second;
    const actualMinutes = (((Number(parts.hour) * 60) + Number(parts.minute)) * 60) + Number(parts.second);
    const dayDelta =
      Date.UTC(year, month - 1, day) -
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    const totalSecondDelta = ((dayDelta / 86400000) * 86400) + (targetMinutes - actualMinutes);

    if (totalSecondDelta === 0) {
      return approximate;
    }

    approximate.setUTCSeconds(approximate.getUTCSeconds() + totalSecondDelta);
  }

  return approximate;
}

function isWeekend(year, month, day) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function previousTradingDay(dateString) {
  const [yearText, monthText, dayText] = String(dateString).split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  let day = Number(dayText);
  let cursor = new Date(Date.UTC(year, month - 1, day));

  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    year = cursor.getUTCFullYear();
    month = cursor.getUTCMonth() + 1;
    day = cursor.getUTCDate();
  } while (isWeekend(year, month, day));

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nextTradingDay(dateString) {
  const [yearText, monthText, dayText] = String(dateString).split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  let day = Number(dayText);
  let cursor = new Date(Date.UTC(year, month - 1, day));

  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    year = cursor.getUTCFullYear();
    month = cursor.getUTCMonth() + 1;
    day = cursor.getUTCDate();
  } while (isWeekend(year, month, day));

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function calculateScheduledSendAt(earningsDate, earningsSession) {
  const session = earningsSession || 'unknown';
  const sendDate = session === 'post_market'
    ? earningsDate
    : previousTradingDay(earningsDate);

  const [year, month, day] = sendDate.split('-').map(Number);
  return easternDateToUtcDate(year, month, day, 15, 0, 0);
}

function normalizeSession(rawText = '') {
  const text = String(rawText || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('before market open') || text.includes('before open') || text.includes('bmo') || text.includes(' 8 am') || text.includes(' 7 am') || text.includes(' 6 am') || text.includes(' 9 am')) {
    return 'pre_market';
  }
  if (text.includes('after market close') || text.includes('after close') || text.includes('amc') || text.includes(' 4 pm') || text.includes(' 5 pm') || text.includes(' 6 pm') || text.includes('pm')) {
    return 'post_market';
  }
  return 'unknown';
}

function mapLegacyEarningsTime(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'bmo') return 'pre_market';
  if (normalized === 'amc') return 'post_market';
  return 'unknown';
}

function summarizeCatalystResults(symbol, results = []) {
  const unique = [];
  const seen = new Set();

  for (const result of results) {
    if (!result?.title) continue;
    const key = `${result.title}::${result.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
    if (unique.length >= 5) break;
  }

  if (!unique.length) {
    return `${symbol}: No fresh pre-earnings catalysts found from structured search sources.`;
  }

  return unique.map((item, index) => {
    const source = item.url ? ` (${item.url})` : '';
    return `${index + 1}. ${item.title}: ${item.content || 'No summary available.'}${source}`;
  }).join('\n');
}

function classifyReaction(movePct, threshold = 1) {
  if (!Number.isFinite(movePct)) return 'unclear';
  if (Math.abs(movePct) < threshold) return 'flat';
  return movePct > 0 ? 'up' : 'down';
}

export async function enrichYahooEarningsTiming(symbol, expectedDate = null) {
  const url = `https://finance.yahoo.com/calendar/earnings?symbol=${encodeURIComponent(symbol)}`;
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });

  const $ = cheerio.load(response.data);
  const scripts = $('script').map((_, el) => $(el).html()).get().filter(Boolean);
  const fallback = {
    symbol,
    earningsDate: expectedDate,
    earningsTimeRaw: null,
    earningsSession: 'unknown',
    source: 'yahoo'
  };

  for (const script of scripts) {
    if (!script.includes(symbol)) continue;

    const matches = script.match(/"rows":(\[[\s\S]*?\])\s*,\s*"sortFields"/);
    if (!matches) continue;

    try {
      const rows = JSON.parse(matches[1]);
      const row = rows.find(item => String(item.symbol || '').toUpperCase() === symbol.toUpperCase());
      if (!row) continue;

      const isoDate = toIsoDate(row.startdatetime || row.startDate || row.earningsDate) || expectedDate;
      const rawText = row.startdatetimetype || row.time || row.epsestimate || null;
      return {
        symbol,
        earningsDate: isoDate,
        earningsTimeRaw: rawText,
        earningsSession: normalizeSession(rawText),
        source: 'yahoo'
      };
    } catch {}
  }

  return fallback;
}

export async function buildEarningsCatalystSummary(symbol) {
  const [earningsContext, stockContext] = await Promise.all([
    tavily.searchStructuredEarningsContext(symbol, { maxResults: 4 }).catch(() => []),
    tavily.searchStructuredStockContext(symbol, { maxResults: 3 }).catch(() => [])
  ]);

  return summarizeCatalystResults(symbol, [...earningsContext, ...stockContext]);
}

export async function getEarningsReminderDetails(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error('Symbol is required');
  }

  const upcoming = await db.getNextEarning(normalizedSymbol);
  if (!upcoming) {
    return null;
  }

  const existingReminder = await db.getActiveEarningsReminder(normalizedSymbol);
  let timing = {
    symbol: normalizedSymbol,
    earningsDate: upcoming.earnings_date,
    earningsTimeRaw: upcoming.timing_raw || upcoming.earnings_time || null,
    earningsSession: upcoming.session_normalized || mapLegacyEarningsTime(upcoming.earnings_time),
    source: upcoming.timing_source || upcoming.source || 'unknown'
  };

  try {
    const yahooTiming = await enrichYahooEarningsTiming(normalizedSymbol, upcoming.earnings_date);
    if (yahooTiming?.earningsTimeRaw || yahooTiming?.earningsSession !== 'unknown') {
      timing = yahooTiming;
      await db.enrichEarningTiming(normalizedSymbol, upcoming.earnings_date, yahooTiming).catch(() => null);
    }
  } catch (error) {
    console.warn(`⚠️ Yahoo timing enrichment failed for ${normalizedSymbol}: ${error.message}`);
  }

  const catalystSummary = existingReminder?.catalyst_summary || await buildEarningsCatalystSummary(normalizedSymbol);
  const effectiveEarningsDate = timing.earningsDate || upcoming.earnings_date;
  const scheduledSendAt = isValidDate(effectiveEarningsDate)
    ? calculateScheduledSendAt(effectiveEarningsDate, timing.earningsSession || 'unknown')
    : null;

  return {
    symbol: normalizedSymbol,
    nextEarning: upcoming,
    timing,
    catalystSummary,
    reminder: existingReminder,
    watchlistContext: existingReminder ? {
      primaryPathway: existingReminder.primary_pathway || null,
      secondaryPathways: existingReminder.secondary_pathways || [],
      analysisReady: existingReminder.analysis_ready ?? null,
      selectionSource: existingReminder.selection_source || null,
      selectionRank: existingReminder.selection_rank_within_pathway ?? null,
      reviewPriority: existingReminder.review_priority ?? null
    } : null,
    scheduledSendAt
  };
}

export async function searchEarningsReminderSymbols(query, limit = 10) {
  return db.searchUpcomingEarningsSymbols(query, limit);
}

export async function syncAutoEarningsReminders(options = {}) {
  const {
    days = 14,
    minMarketCap = 10000000000
  } = options;

  const upcoming = await db.getUpcomingEarningsForAutoReminders(days, minMarketCap);
  const results = [];

  for (const item of upcoming) {
    try {
      const existing = await db.getActiveEarningsReminder(item.symbol);
      const saved = await saveEarningsReminder({
        symbol: item.symbol,
        notes: existing?.notes || '',
        earningsSession: existing?.earnings_session || undefined,
        earningsTimeRaw: existing?.earnings_time_raw || undefined,
        earningsSessionSource: existing?.earnings_session_source || undefined,
        catalystSummary: existing?.catalyst_summary || undefined,
        emailEnabled: existing?.email_enabled !== false
      });
      results.push(saved);
    } catch (error) {
      console.warn(`⚠️ Failed to sync auto earnings reminder for ${item.symbol}: ${error.message}`);
    }
  }

  return results;
}

export async function saveEarningsReminder(payload) {
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('Symbol is required');

  const details = await getEarningsReminderDetails(symbol);
  if (!details) {
    throw new Error(`No upcoming earnings found for ${symbol}`);
  }

  const earningsDate = details.timing.earningsDate || details.nextEarning.earnings_date;
  const earningsSession = payload.earningsSession || details.timing.earningsSession || 'unknown';
  const earningsTimeRaw = payload.earningsTimeRaw || details.timing.earningsTimeRaw || details.nextEarning.earnings_time || null;
  const earningsSessionSource = payload.earningsSessionSource || details.timing.source || 'unknown';
  const catalystSummary = payload.catalystSummary || details.catalystSummary || null;
  const scheduledSendAt = calculateScheduledSendAt(earningsDate, earningsSession);

  const reminder = await db.upsertEarningsReminder({
    symbol,
    earningsDate,
    earningsTimeRaw,
    earningsSession,
    earningsSessionSource,
    catalystSummary,
    notes: payload.notes || '',
    scheduledSendAt,
    emailEnabled: payload.emailEnabled !== false
  });

  return {
    ...reminder,
    scheduled_send_at: scheduledSendAt,
    catalyst_summary: catalystSummary
  };
}

function parsePredictorResponse(text) {
  const prediction = text.match(/PREDICTION:\s*(UP|DOWN|NEUTRAL)/i)?.[1]?.toLowerCase() || 'neutral';
  const confidence = text.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i)?.[1]?.toLowerCase() || 'medium';
  const why = text.match(/WHY:\s*([\s\S]*?)(?:KEY_RISK:|$)/i)?.[1]?.trim() || text.trim();
  return {
    direction: prediction,
    confidence,
    reasoning: why
  };
}

export async function runOfficialReminderPrediction(reminder) {
  const symbol = reminder.symbol;
  const marketOpen = false;
  const [quote, catalystSummary] = await Promise.all([
    fmp.getQuote(symbol).catch(() => null),
    Promise.resolve(reminder.catalyst_summary || '').then(async existing => existing || buildEarningsCatalystSummary(symbol))
  ]);
  const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: null });

  const prompt = `You are Whiskie. Predict the likely stock reaction immediately after earnings for ${symbol}.

Context:
- Earnings date: ${reminder.earnings_date}
- Earnings session: ${reminder.earnings_session}
- Current price: ${currentPrice ?? 'unknown'}
- Fresh catalysts:
${catalystSummary}

Focus on stock reaction, not raw beat/miss odds. Weigh expectations, valuation, setup, guidance risk, positioning, and current catalysts.

Return exactly:
PREDICTION: UP / DOWN / NEUTRAL
CONFIDENCE: HIGH / MEDIUM / LOW
WHY: 2-4 concise bullets
KEY_RISK: one concise sentence`;

  const response = await claude.sendMessage(
    [{ role: 'user', content: prompt }],
    MODELS.OPUS,
    null,
    true,
    12000,
    { quiet: true }
  );

  const text = response?.content?.map(block => block?.text).filter(Boolean).join('\n') || '';
  const parsed = parsePredictorResponse(text);

  return {
    ...parsed,
    catalystSummary,
    snapshotPrice: currentPrice,
    predictorRunAt: new Date(),
    rawResponse: text
  };
}

export async function gradeEarningsReminder(reminder) {
  if (!reminder?.predictor_snapshot_price || !reminder?.earnings_date) {
    return null;
  }

  const nextSessionDate = nextTradingDay(reminder.earnings_date);
  const quote = await fmp.getQuote(reminder.symbol).catch(() => null);
  const closePrice = resolveMarketPrice(quote, { marketOpen: false, fallback: null });

  if (!Number.isFinite(Number(closePrice))) {
    return null;
  }

  const snapshotPrice = Number(reminder.predictor_snapshot_price);
  const actualReactionPct = snapshotPrice > 0
    ? ((Number(closePrice) - snapshotPrice) / snapshotPrice) * 100
    : null;
  const actualReactionDirection = classifyReaction(actualReactionPct);
  const predictedDirection = String(reminder.predicted_direction || '').toLowerCase();
  const gradeResult = actualReactionDirection === 'flat'
    ? 'flat'
    : actualReactionDirection === 'unclear'
      ? 'unclear'
      : predictedDirection === actualReactionDirection
        ? 'correct'
        : 'incorrect';

  return db.saveEarningsReminderGrade(reminder.id, {
    actualReactionDirection,
    actualReactionPct,
    gradeResult,
    gradedAt: new Date(),
    referenceSessionDate: nextSessionDate
  });
}

export function formatEarningsReminderEmail(reminder) {
  const scheduled = reminder.scheduled_send_at
    ? new Date(reminder.scheduled_send_at).toLocaleString('en-US', { timeZone: EASTERN_TIMEZONE })
    : 'N/A';
  return `
    <h2>Earnings Reminder: ${escapeHtml(reminder.symbol)}</h2>
    <p><strong>Earnings Date:</strong> ${escapeHtml(reminder.earnings_date)}</p>
    <p><strong>Session:</strong> ${escapeHtml(reminder.earnings_session || 'unknown')}</p>
    ${reminder.earnings_time_raw ? `<p><strong>Timing Detail:</strong> ${escapeHtml(reminder.earnings_time_raw)}</p>` : ''}
    <p><strong>Reminder Time:</strong> ${escapeHtml(scheduled)} ET</p>
    <hr>
    <h3>Latest Catalysts</h3>
    <pre>${escapeHtml(reminder.prediction_catalyst_summary || reminder.catalyst_summary || 'No catalyst summary available.')}</pre>
    ${reminder.notes ? `<h3>Notes</h3><p>${escapeHtml(reminder.notes)}</p>` : ''}
    <hr>
    <h3>Reaction Predictor</h3>
    <p><strong>Direction:</strong> ${escapeHtml((reminder.predicted_direction || 'unknown').toUpperCase())}</p>
    <p><strong>Confidence:</strong> ${escapeHtml((reminder.predicted_confidence || 'unknown').toUpperCase())}</p>
    <pre>${escapeHtml(reminder.prediction_reasoning || 'No prediction reasoning available.')}</pre>
  `;
}

export default {
  searchEarningsReminderSymbols,
  syncAutoEarningsReminders,
  getEarningsReminderDetails,
  saveEarningsReminder,
  runOfficialReminderPrediction,
  gradeEarningsReminder,
  formatEarningsReminderEmail,
  buildEarningsCatalystSummary,
  enrichYahooEarningsTiming,
  calculateScheduledSendAt
};
