/**
 * Macro Calendar - Economic Event Tracking
 * Combines FRED API (CPI, PPI, NFP) with hardcoded FOMC dates
 */

import dotenv from 'dotenv';
dotenv.config();

const FRED_API_KEY = process.env.FRED_API_KEY || '';
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';

/**
 * FOMC Meeting Dates for 2026
 * Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * Update annually (typically published a year in advance)
 */
const FOMC_MEETINGS_2026 = [
  { date: '2026-01-28', name: 'FOMC Meeting (Jan)', description: 'Federal Reserve policy decision' },
  { date: '2026-03-18', name: 'FOMC Meeting (Mar)', description: 'Federal Reserve policy decision' },
  { date: '2026-04-29', name: 'FOMC Meeting (Apr)', description: 'Federal Reserve policy decision' },
  { date: '2026-06-17', name: 'FOMC Meeting (Jun)', description: 'Federal Reserve policy decision' },
  { date: '2026-07-29', name: 'FOMC Meeting (Jul)', description: 'Federal Reserve policy decision' },
  { date: '2026-09-16', name: 'FOMC Meeting (Sep)', description: 'Federal Reserve policy decision' },
  { date: '2026-10-28', name: 'FOMC Meeting (Oct)', description: 'Federal Reserve policy decision' },
  { date: '2026-12-09', name: 'FOMC Meeting (Dec)', description: 'Federal Reserve policy decision' }
];

/**
 * FRED Release IDs for key economic indicators
 */
const FRED_RELEASES = {
  CPI: 10,   // Consumer Price Index
  PPI: 46,   // Producer Price Index
  NFP: 50    // Employment Situation (Non-Farm Payrolls)
};

/**
 * Fetch upcoming release dates from FRED API
 */
async function fetchFredReleaseDates(releaseId, daysAhead = 60) {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + daysAhead);

  const realtimeStart = today.toISOString().split('T')[0];
  const realtimeEnd = futureDate.toISOString().split('T')[0];

  if (!FRED_API_KEY) {
    console.warn(`⚠️ Skipping FRED release dates for ${releaseId}: FRED_API_KEY is not configured`);
    return [];
  }

  const url = `${FRED_BASE_URL}/release/dates?release_id=${releaseId}&api_key=${FRED_API_KEY}&file_type=json&realtime_start=${realtimeStart}&realtime_end=${realtimeEnd}&sort_order=asc`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FRED API error: ${response.status}`);
    }
    const data = await response.json();
    return data.release_dates || [];
  } catch (error) {
    console.warn(`⚠️ Could not fetch FRED release dates for ${releaseId}:`, error.message);
    return [];
  }
}

/**
 * Get all upcoming macro events (FOMC + CPI + PPI + NFP)
 */
async function getUpcomingEvents(daysAhead = 30) {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + daysAhead);

  const events = [];

  // Add FOMC meetings
  for (const meeting of FOMC_MEETINGS_2026) {
    const meetingDate = new Date(meeting.date);
    if (meetingDate >= today && meetingDate <= futureDate) {
      events.push({
        date: meeting.date,
        type: 'FOMC',
        name: meeting.name,
        impact: 'HIGH',
        description: meeting.description
      });
    }
  }

  // Fetch CPI release dates
  const cpiDates = await fetchFredReleaseDates(FRED_RELEASES.CPI, daysAhead);
  for (const release of cpiDates) {
    events.push({
      date: release.date,
      type: 'CPI',
      name: 'CPI Report',
      impact: 'HIGH',
      description: 'Consumer Price Index - inflation data'
    });
  }

  // Fetch PPI release dates
  const ppiDates = await fetchFredReleaseDates(FRED_RELEASES.PPI, daysAhead);
  for (const release of ppiDates) {
    events.push({
      date: release.date,
      type: 'PPI',
      name: 'PPI Report',
      impact: 'MEDIUM',
      description: 'Producer Price Index - wholesale inflation'
    });
  }

  // Fetch NFP release dates
  const nfpDates = await fetchFredReleaseDates(FRED_RELEASES.NFP, daysAhead);
  for (const release of nfpDates) {
    events.push({
      date: release.date,
      type: 'NFP',
      name: 'Jobs Report (NFP)',
      impact: 'HIGH',
      description: 'Non-Farm Payrolls - employment data'
    });
  }

  // Sort by date
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  return events;
}

/**
 * Get events happening today
 */
async function getTodayEvents() {
  const today = new Date().toISOString().split('T')[0];
  const allEvents = await getUpcomingEvents(1);
  return allEvents.filter(e => e.date === today);
}

/**
 * Check if today is a macro event day
 */
async function isMacroEventDay() {
  const todayEvents = await getTodayEvents();
  return todayEvents.length > 0;
}

/**
 * Build macro context string for Claude's prompt
 */
async function buildMacroContext(daysAhead = 7) {
  const events = await getUpcomingEvents(daysAhead);

  if (events.length === 0) {
    return '\nMACRO CALENDAR: No major economic events in next 7 days.\n';
  }

  let context = '\nMACRO CALENDAR (next 7 days):\n';

  const todayEvents = events.filter(e => e.date === new Date().toISOString().split('T')[0]);
  if (todayEvents.length > 0) {
    context += '⚠️ TODAY:\n';
    for (const event of todayEvents) {
      context += `  • ${event.name} (${event.type}) - ${event.impact} IMPACT\n`;
      context += `    ${event.description}\n`;
    }
    context += '\n→ CAUTION: Tighten stops on affected positions, avoid large new entries, factor macro risk into all recommendations.\n\n';
  }

  const upcomingEvents = events.filter(e => e.date !== new Date().toISOString().split('T')[0]);
  if (upcomingEvents.length > 0) {
    context += 'UPCOMING:\n';
    for (const event of upcomingEvents) {
      const daysUntil = Math.ceil((new Date(event.date) - new Date()) / (1000 * 60 * 60 * 24));
      context += `  • ${event.date} (${daysUntil}d): ${event.name} (${event.type}) - ${event.impact} IMPACT\n`;
    }
  }

  return context;
}

export default {
  getUpcomingEvents,
  getTodayEvents,
  isMacroEventDay,
  buildMacroContext
};
