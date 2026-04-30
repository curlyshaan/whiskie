import axios from 'axios';
import * as db from './db.js';
import fmp from './fmp.js';
import newsSearch from './news-search.js';
import claude, { MODELS } from './claude.js';
import { resolveMarketPrice } from './utils.js';
import { ensureFreshStockProfile } from './stock-profiles.js';

const EASTERN_TIMEZONE = 'America/New_York';
const TIMING_RAW_LIMIT = 10;
const SESSION_SOURCE_LIMIT = 20;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return value.trim();
  }
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

function calculateGradeEligibleAt(earningsDate, earningsSession) {
  if (!earningsDate) return null;

  const session = String(earningsSession || 'unknown').toLowerCase();
  const gradeDate = session === 'pre_market'
    ? earningsDate
    : nextTradingDay(earningsDate);

  const [year, month, day] = String(gradeDate).split('-').map(Number);
  return easternDateToUtcDate(year, month, day, 11, 0, 0);
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
  const text = ` ${String(rawText || '').toLowerCase()} `;
  if (!text) return 'unknown';
  if (text.includes('before market open') || text.includes('before open') || text.includes('bmo')) {
    return 'pre_market';
  }
  if (text.includes('after market close') || text.includes('after close') || text.includes('amc') || text.includes('post_mark')) {
    return 'post_market';
  }
  if (text.includes('pre_mark')) {
    return 'pre_market';
  }

  const clockMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clockMatch) {
    let hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2] || '0');
    const meridiem = clockMatch[3];

    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    const minutesSinceMidnight = (hour * 60) + minute;
    return minutesSinceMidnight < 12 * 60 ? 'pre_market' : 'post_market';
  }

  return 'unknown';
}

function isSessionKnown(value) {
  return value === 'pre_market' || value === 'post_market';
}

function choosePreferredSession(...candidates) {
  for (const candidate of candidates) {
    if (isSessionKnown(candidate)) return candidate;
  }
  return 'unknown';
}

function mapLegacyEarningsTime(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'bmo') return 'pre_market';
  if (normalized === 'amc') return 'post_market';
  return 'unknown';
}

function summarizeTimingValue(value, maxLength) {
  const normalized = String(value || '')
    .replace(/\bbefore market open\b/gi, 'bmo')
    .replace(/\bbefore open\b/gi, 'bmo')
    .replace(/\bafter market close\b/gi, 'amc')
    .replace(/\bafter close\b/gi, 'amc')
    .replace(/\s*(EDT|EST|ET|UTC|GMT)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;

  const timeMatch = normalized.match(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i);
  if (timeMatch && timeMatch[0].length <= maxLength) {
    return timeMatch[0].toUpperCase();
  }

  if (normalized.toLowerCase().includes('bmo')) return 'bmo';
  if (normalized.toLowerCase().includes('amc')) return 'amc';

  return normalized.slice(0, maxLength).trim();
}

function normalizeTimingPayload(rawTiming, fallbackDate) {
  const earningsDate = toIsoDate(rawTiming?.earningsDate) || toIsoDate(fallbackDate) || fallbackDate || null;
  const rawTimeInput = String(rawTiming?.earningsTimeRaw || '').trim();
  const normalizedShortTime = summarizeTimingValue(rawTimeInput, TIMING_RAW_LIMIT);
  const source = summarizeTimingValue(String(rawTiming?.source || 'unknown').trim().toLowerCase(), SESSION_SOURCE_LIMIT) || 'unknown';
  const explicitSession = String(rawTiming?.earningsSession || '').trim().toLowerCase().replace(/\s+/g, '_');
  const mappedSession = choosePreferredSession(
    explicitSession,
    mapLegacyEarningsTime(rawTimeInput),
    normalizeSession(rawTimeInput)
  );
  const earningsSession = summarizeTimingValue(
    String(mappedSession).trim().toLowerCase().replace(/\s+/g, '_'),
    SESSION_SOURCE_LIMIT
  ) || 'unknown';
  return {
    symbol: rawTiming?.symbol || null,
    earningsDate,
    earningsTimeRaw: normalizedShortTime,
    earningsSession,
    source
  };
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

function filterResultsForSymbolIdentity(symbol, companyName, results = []) {
  const symbolToken = String(symbol || '').trim().toUpperCase();
  const company = String(companyName || '').trim().toLowerCase();
  const companyWords = company.split(/\s+/).filter(word => word.length >= 4).slice(0, 3);

  return results.filter(result => {
    const haystack = `${result?.title || ''} ${result?.content || ''}`.toLowerCase();
    if (!haystack) return false;
    if (new RegExp(`\\b${symbolToken.toLowerCase()}\\b`, 'i').test(haystack)) return true;
    return companyWords.some(word => haystack.includes(word));
  });
}

export async function buildEarningsCatalystBrief(symbol, existingSummary = null) {
  const rawSummary = existingSummary || await buildEarningsCatalystSummary(symbol);
  const prompt = `You are preparing a concise earnings-preview catalyst brief for ${symbol}.

Summarize the raw context below into exactly 4-6 bullets focused on:
- what matters into the print
- expectations/setup
- likely swing factors
- major risk

Keep it crisp, investor-readable, and specific to ${symbol}.
Do not repeat raw article metadata, URLs, or site boilerplate.

Raw context:
${rawSummary}`;

  const response = await claude.sendMessage(
    [{ role: 'user', content: prompt }],
    MODELS.OPUS,
    null,
    true,
    8000,
    { quiet: true, maxTokens: 1200 }
  );

  const text = response?.content?.map(block => block?.text).filter(Boolean).join('\n').trim() || rawSummary;
  return text;
}

function formatPredictorReasoningHtml(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return '<div>No prediction reasoning available.</div>';
  }

  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-•]\s*/, ''));

  if (!lines.length) {
    return '<div>No prediction reasoning available.</div>';
  }

  return `<ul style="margin:0; padding-left:18px;">${lines.map(line => `<li style="margin-bottom:6px;">${escapeHtml(line)}</li>`).join('')}</ul>`;
}


export function computeEarningsGrade(snapshotPrice, referencePrice, predictedDirection) {
  const normalizedSnapshot = Number(snapshotPrice);
  const normalizedReference = Number(referencePrice);
  const actualReactionPct = normalizedSnapshot > 0 && Number.isFinite(normalizedReference)
    ? ((normalizedReference - normalizedSnapshot) / normalizedSnapshot) * 100
    : null;
  const actualReactionDirection = classifyReaction(actualReactionPct);
  const normalizedPrediction = ['up', 'down', 'flat'].includes(String(predictedDirection || '').toLowerCase())
    ? String(predictedDirection || '').toLowerCase()
    : 'unclear';
  const gradeResult = actualReactionDirection === 'flat'
    ? (normalizedPrediction === 'flat' ? 'correct' : 'incorrect')
    : actualReactionDirection === 'unclear'
      ? 'unclear'
      : normalizedPrediction === actualReactionDirection
        ? 'correct'
        : 'incorrect';

  return {
    actualReactionPct,
    actualReactionDirection,
    gradeResult
  };
}

function classifyReaction(movePct, threshold = 1) {
  if (!Number.isFinite(movePct)) return 'unclear';
  if (Math.abs(movePct) < threshold) return 'flat';
  return movePct > 0 ? 'up' : 'down';
}

let doltHubTimingFailureCount = 0;

export async function enrichDoltHubTiming(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  try {
    const query = `SELECT act_symbol, date, \`when\`
FROM \`earnings_calendar\`
WHERE act_symbol = '${normalizedSymbol.replace(/'/g, "''")}'
ORDER BY \`date\` DESC
LIMIT 1;`;
    const response = await axios.get('https://www.dolthub.com/api/v1alpha1/post-no-preference/earnings/master', {
      params: { q: query },
      timeout: 10000
    });

    const row = response?.data?.rows?.[0] || null;
    const rawText = String(row?.when || '').trim();
    const normalizedSession = normalizeSession(rawText);
    const summarizedRaw = summarizeTimingValue(rawText, TIMING_RAW_LIMIT);

    return {
      symbol: normalizedSymbol,
      earningsTimeRaw: summarizedRaw,
      earningsSession: normalizedSession || 'unknown',
      source: 'dolthub'
    };
  } catch (error) {
    doltHubTimingFailureCount += 1;
    if (doltHubTimingFailureCount <= 3) {
      console.warn(`⚠️ DoltHub timing enrichment failed for ${normalizedSymbol}: ${error.message}`);
    } else if (doltHubTimingFailureCount === 4) {
      console.warn('⚠️ DoltHub timing enrichment failures are recurring; suppressing additional per-symbol warnings for this run');
    }
  }

  return {
    symbol: normalizedSymbol,
    earningsTimeRaw: null,
    earningsSession: 'unknown',
    source: 'dolthub'
  };
}

export async function buildEarningsCatalystSummary(symbol, options = {}) {
  const companyName = options.companyName || '';
  const [earningsHealth, stockHealth] = await Promise.all([
    newsSearch.getStructuredEarningsContextWithHealth(symbol, { maxResults: 4, companyName }),
    newsSearch.getStructuredStockContextWithHealth(symbol, { maxResults: 3, companyName, timeRange: 'week' })
  ]);

  const filtered = filterResultsForSymbolIdentity(
    symbol,
    companyName,
    [...(earningsHealth.results || []), ...(stockHealth.results || [])]
  );
  const summary = summarizeCatalystResults(symbol, filtered);
  if (!earningsHealth.degraded && !stockHealth.degraded) {
    return summary;
  }
  const warnings = [earningsHealth, stockHealth]
    .filter(item => item.degraded)
    .map(item => `${item.providerStatus}${item.warning ? ` (${item.warning})` : ''}`)
    .join('; ');
  return `[SERPER DEGRADED: ${warnings}] ${summary}`;
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
  const stockInfo = await db.getStockInfo(normalizedSymbol);

  const existingReminder = await db.getActiveEarningsReminder(normalizedSymbol);
  const fallbackSession = upcoming.session_normalized && upcoming.session_normalized !== 'unknown'
    ? upcoming.session_normalized
    : mapLegacyEarningsTime(upcoming.earnings_time);

  let timing = {
    symbol: normalizedSymbol,
    earningsDate: upcoming.earnings_date,
    earningsTimeRaw: upcoming.timing_raw || upcoming.earnings_time || null,
    earningsSession: fallbackSession || 'unknown',
    source: upcoming.timing_source || upcoming.source || 'unknown'
  };

  timing = normalizeTimingPayload(timing, upcoming.earnings_date);

  const catalystSummary = existingReminder?.catalyst_summary || await buildEarningsCatalystSummary(normalizedSymbol, {
    companyName: stockInfo?.company_name
  });
  const effectiveEarningsDate = timing.earningsDate || upcoming.earnings_date;
  const scheduledSendAt = isValidDate(effectiveEarningsDate)
    ? calculateScheduledSendAt(effectiveEarningsDate, timing.earningsSession || 'unknown')
    : null;

  return {
    symbol: normalizedSymbol,
    nextEarning: upcoming,
    stockInfo,
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
    scheduledSendAt,
    earningsOptionsMode: {
      symbol: normalizedSymbol,
      intentHorizon: 'short_term',
      eventMode: 'earnings',
      earningsDate: effectiveEarningsDate,
      earningsSession: timing.earningsSession || 'unknown'
    }
  };
}

export async function searchEarningsReminderSymbols(query, limit = 10) {
  return db.searchUpcomingEarningsSymbols(query, limit);
}

export async function syncAutoEarningsReminders(options = {}) {
  const {
    days = 7,
    minMarketCap = 10000000000
  } = options;

  const upcoming = await db.getUpcomingEarningsForAutoReminders(days, minMarketCap);
  const results = [];

  for (const item of upcoming) {
    try {
      const earningsDate = toIsoDate(item.earnings_date);
      const existing = await db.getActiveEarningsReminder(item.symbol);
      const existingMatchesSameEvent = existing && earningsDate
        ? toIsoDate(existing.earnings_date) === earningsDate
        : false;
      const shouldRefreshTiming = !existing
        || !existingMatchesSameEvent
        || existing.earnings_session === 'unknown'
        || (existing.earnings_date && earningsDate && toIsoDate(existing.earnings_date) !== earningsDate);
      const doltHubTiming = shouldRefreshTiming
        ? await enrichDoltHubTiming(item.symbol)
        : null;
      const saved = await saveEarningsReminder({
        symbol: item.symbol,
        notes: existingMatchesSameEvent ? (existing?.notes || '') : '',
        earningsSession: doltHubTiming?.earningsSession && doltHubTiming.earningsSession !== 'unknown'
          ? doltHubTiming.earningsSession
          : (existingMatchesSameEvent ? existing?.earnings_session : undefined),
        earningsTimeRaw: doltHubTiming?.earningsTimeRaw || (existingMatchesSameEvent ? existing?.earnings_time_raw : undefined),
        earningsSessionSource: doltHubTiming?.earningsSession && doltHubTiming.earningsSession !== 'unknown'
          ? doltHubTiming.source
          : (existingMatchesSameEvent ? existing?.earnings_session_source : undefined),
        catalystSummary: existingMatchesSameEvent ? existing?.catalyst_summary : undefined,
        emailEnabled: existingMatchesSameEvent ? existing?.email_enabled !== false : true
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
  const earningsTimeRaw = normalizeTimingPayload({
    earningsTimeRaw: payload.earningsTimeRaw || details.timing.earningsTimeRaw || details.nextEarning.earnings_time || null,
    earningsSession: payload.earningsSession || details.timing.earningsSession || details.nextEarning.session_normalized || 'unknown',
    source: payload.earningsSessionSource || details.timing.source || 'unknown'
  }, earningsDate).earningsTimeRaw;
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
  const keyRisk = text.match(/KEY_RISK:\s*([\s\S]*?)$/i)?.[1]?.trim() || '';
  return {
    direction: prediction,
    confidence,
    reasoning: why,
    keyRisk
  };
}

export async function runOfficialReminderPrediction(reminder) {
  const symbol = reminder.symbol;
  const ensured = await ensureFreshStockProfile(symbol, { staleAfterDays: 14 });
  const profile = ensured?.profile || null;
  const stockInfo = await db.getStockInfo(symbol);
  const marketOpen = false;
  const [quote, rawCatalystSummary, latestNewsHealth] = await Promise.all([
    fmp.getQuote(symbol).catch(() => null),
    Promise.resolve(reminder.catalyst_summary || '').then(async existing => existing || buildEarningsCatalystSummary(symbol, {
      companyName: stockInfo?.company_name
    })),
    newsSearch.getStructuredStockContextWithHealth(symbol, {
      maxResults: 4,
      companyName: stockInfo?.company_name,
      timeRange: 'week'
    })
  ]);
  const filteredNews = filterResultsForSymbolIdentity(
    symbol,
    stockInfo?.company_name,
    latestNewsHealth?.results || []
  ).slice(0, 4);
  const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: null });
  const catalystBrief = await buildEarningsCatalystBrief(symbol, rawCatalystSummary)
    .catch(() => rawCatalystSummary);
  const latestNewsText = filteredNews.length
    ? filteredNews.map((item, index) => `${index + 1}. ${item.title}: ${item.content || 'No summary available.'}`).join('\n')
    : 'No high-confidence latest news matches found.';
  const profileContext = profile ? `Profile business model: ${profile.business_model || 'N/A'}
Profile catalysts: ${profile.catalysts || 'N/A'}
Profile risks: ${profile.risks || 'N/A'}
Profile moats: ${profile.moats || 'N/A'}` : 'No stock profile context available.';

  const prompt = `You are Whiskie. Predict the likely stock reaction immediately after earnings for ${symbol}.

Context:
- Company: ${stockInfo?.company_name || 'Unknown'}
- Earnings date: ${reminder.earnings_date}
- Earnings session: ${reminder.earnings_session}
- Current price: ${currentPrice ?? 'unknown'}
- Stock profile context:
${profileContext}
- Fresh catalysts:
${catalystBrief}
- Fresh latest news:
${latestNewsText}

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
    catalystSummary: catalystBrief,
    snapshotPrice: currentPrice,
    predictorRunAt: new Date(),
    rawResponse: text
  };
}

export async function buildLiveReminderPreview(symbol) {
  const details = await getEarningsReminderDetails(symbol);
  if (!details) return null;

  const [quote, catalystBrief] = await Promise.all([
    fmp.getQuote(symbol).catch(() => null),
    buildEarningsCatalystBrief(symbol, details.catalystSummary).catch(() => details.catalystSummary || 'No catalyst summary available.')
  ]);

  const currentPrice = resolveMarketPrice(quote, { marketOpen: false, fallback: null });
  const preview = await runOfficialReminderPrediction({
    symbol,
    earnings_date: details.timing.earningsDate || details.nextEarning.earnings_date,
    earnings_session: details.timing.earningsSession || details.nextEarning.session_normalized || 'unknown',
    catalyst_summary: catalystBrief
  });

  return {
    symbol,
    currentPrice,
    catalystBrief,
    stockInfo: details.stockInfo || null,
    preview
  };
}

export async function gradeEarningsReminder(reminder) {
  if (!reminder?.predictor_snapshot_price || !reminder?.earnings_date) {
    return null;
  }

  const normalizedEarningsDate = toIsoDate(reminder.earnings_date);
  if (!normalizedEarningsDate) {
    return null;
  }

  const session = String(reminder.earnings_session || '').toLowerCase();
  const referenceSessionDate = session === 'pre_market'
    ? normalizedEarningsDate
    : nextTradingDay(normalizedEarningsDate);
  const quote = await fmp.getQuote(reminder.symbol).catch(() => null);

  const preferredReferencePrice = (() => {
    if (session === 'post_market') {
      return Number(quote?.previousClose ?? quote?.close ?? null);
    }
    if (session === 'pre_market') {
      return Number(quote?.price ?? quote?.previousClose ?? quote?.close ?? null);
    }
    return Number(quote?.price ?? quote?.previousClose ?? quote?.close ?? null);
  })();

  if (!Number.isFinite(preferredReferencePrice)) {
    return null;
  }

  const snapshotPrice = Number(reminder.predictor_snapshot_price);
  const { actualReactionPct, actualReactionDirection, gradeResult } = computeEarningsGrade(
    snapshotPrice,
    preferredReferencePrice,
    reminder.predicted_direction
  );

  return db.saveEarningsReminderGrade(reminder.id, {
    actualReactionDirection,
    actualReactionPct,
    gradeResult,
    gradedAt: new Date(),
    referenceSessionDate,
    referencePrice: preferredReferencePrice
  });
}

export function formatEarningsReminderEmail(reminder) {
  const scheduled = reminder.scheduled_send_at
    ? new Date(reminder.scheduled_send_at).toLocaleString('en-US', { timeZone: EASTERN_TIMEZONE })
    : 'N/A';
  return `
    <h2>Earnings Predictor: ${escapeHtml(reminder.symbol)}</h2>
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
    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
      <div style="padding:10px 14px; border-radius:10px; background:#0f172a; border:1px solid #1e293b;">
        <div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Direction</div>
        <div style="font-size:20px; font-weight:700;">${escapeHtml((reminder.predicted_direction || 'unknown').toUpperCase())}</div>
      </div>
      <div style="padding:10px 14px; border-radius:10px; background:#0f172a; border:1px solid #1e293b;">
        <div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Confidence</div>
        <div style="font-size:20px; font-weight:700;">${escapeHtml((reminder.predicted_confidence || 'unknown').toUpperCase())}</div>
      </div>
    </div>
    ${formatPredictorReasoningHtml(reminder.prediction_reasoning)}
    ${reminder.prediction_key_risk ? `<p style="margin-top:14px;"><strong>Key Risk:</strong> ${escapeHtml(reminder.prediction_key_risk)}</p>` : ''}
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
  buildEarningsCatalystBrief,
  buildLiveReminderPreview,
  enrichDoltHubTiming,
  calculateScheduledSendAt,
  calculateGradeEligibleAt
};
