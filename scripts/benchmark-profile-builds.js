import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import claude, { MODELS } from '../src/claude.js';
import fmp from '../src/fmp.js';
import tavily from '../src/tavily.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const symbols = ['AAPL', 'ABBV', 'ABNB', 'ACGL', 'ADBE', 'IREN', 'MSFT', 'GOOG'];

function cleanText(text, maxChars = 2000) {
  if (!text) return '';

  let cleaned = text.replace(/^#+\s+/gm, '');
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/^\*\*+\s*/, '');
  cleaned = cleaned.replace(/\s*\*\*+$/, '');
  cleaned = cleaned.replace(/^[\s]*[-*•]\s+/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars).trim();
    const lastPeriod = cleaned.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.8) {
      cleaned = cleaned.substring(0, lastPeriod + 1);
    }
  }

  return cleaned;
}

function parseResearchIntoProfile(symbol, researchText, fundamentals) {
  const normalized = String(researchText || '').replace(/\r\n/g, '\n');
  const sectionAliases = {
    BUSINESS_MODEL: ['BUSINESS_MODEL', 'Business Model'],
    MOATS: ['MOATS', 'Moats'],
    COMPETITIVE_ADVANTAGES: ['COMPETITIVE_ADVANTAGES', 'Competitive Advantages'],
    COMPETITIVE_LANDSCAPE: ['COMPETITIVE_LANDSCAPE', 'Competitive Landscape'],
    MANAGEMENT_QUALITY: ['MANAGEMENT_QUALITY', 'Management Quality'],
    VALUATION_FRAMEWORK: ['VALUATION_FRAMEWORK', 'Valuation Framework'],
    FUNDAMENTALS_SUMMARY: ['FUNDAMENTALS_SUMMARY', 'Fundamentals Summary'],
    RISKS: ['RISKS', 'Risks'],
    CATALYSTS: ['CATALYSTS', 'Catalysts'],
    METADATA: ['METADATA', 'Metadata']
  };

  const sectionValues = {};
  let currentSection = null;
  const lines = normalized.split('\n');

  const normalizeHeaderCandidate = (value) => String(value || '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*+/, '')
    .replace(/\*\*+$/, '')
    .replace(/^[_*`~-]+/, '')
    .replace(/[_*`~-]+$/, '')
    .replace(/^\d+[\.)]\s*/, '')
    .replace(/^\(?[A-Z]\)\s*/, '')
    .trim();

  const findSectionMatch = (value) => {
    const cleanedValue = normalizeHeaderCandidate(value).replace(/:$/, '').trim();
    if (!cleanedValue) return null;

    return Object.entries(sectionAliases).find(([, aliases]) =>
      aliases.some(alias => alias.toLowerCase() === cleanedValue.toLowerCase())
    )?.[0] || null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentSection) sectionValues[currentSection].push(rawLine);
      continue;
    }

    let matchedSection = findSectionMatch(line);
    let inlineContent = '';

    if (!matchedSection) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const headerCandidate = line.slice(0, colonIndex);
        matchedSection = findSectionMatch(headerCandidate);
        if (matchedSection) inlineContent = line.slice(colonIndex + 1).trim();
      }
    }

    if (matchedSection) {
      currentSection = matchedSection;
      if (!sectionValues[currentSection]) sectionValues[currentSection] = [];
      if (inlineContent) sectionValues[currentSection].push(inlineContent);
      continue;
    }

    if (currentSection) sectionValues[currentSection].push(rawLine);
  }

  const metadata = sectionValues.METADATA?.join('\n').trim() || '';
  const marketCap = fundamentals?.marketCap || 0;

  const market_cap_category =
    marketCap > 200000000000 ? 'mega'
      : marketCap > 10000000000 ? 'large'
        : marketCap > 2000000000 ? 'mid'
          : 'small';

  return {
    symbol,
    business_model: cleanText(sectionValues.BUSINESS_MODEL?.join('\n').trim() || normalized.substring(0, 2000), 2000),
    moats: cleanText(sectionValues.MOATS?.join('\n').trim() || '', 2000),
    competitive_advantages: cleanText(sectionValues.COMPETITIVE_ADVANTAGES?.join('\n').trim() || '', 2000),
    competitive_landscape: cleanText(sectionValues.COMPETITIVE_LANDSCAPE?.join('\n').trim() || '', 2000),
    management_quality: cleanText(sectionValues.MANAGEMENT_QUALITY?.join('\n').trim() || '', 2000),
    valuation_framework: cleanText(sectionValues.VALUATION_FRAMEWORK?.join('\n').trim() || '', 2000),
    risks: cleanText(sectionValues.RISKS?.join('\n').trim() || '', 2000),
    catalysts: cleanText(sectionValues.CATALYSTS?.join('\n').trim() || '', 2000),
    market_cap_category,
    metadata_present: Boolean(metadata)
  };
}

function buildPrompt(symbol, fundamentals, historicalData, news) {
  return `Conduct comprehensive research on ${symbol} and build a detailed stock profile.

**Available Data:**

**Fundamentals (FMP):**
${JSON.stringify(fundamentals, null, 2)}

**Price History (1 year):**
- Current: $${historicalData[historicalData.length - 1]?.close || 'N/A'}
- 52-week high: $${Math.max(...historicalData.map(d => d.high)).toFixed(2)}
- 52-week low: $${Math.min(...historicalData.map(d => d.low)).toFixed(2)}
- YTD return: ${(((historicalData[historicalData.length - 1]?.close - historicalData[0]?.close) / historicalData[0]?.close) * 100).toFixed(1)}%

**Recent News:**
${news.map(n => `- ${n.title}\n  ${n.content?.substring(0, 200)}...`).join('\n\n')}

**Your Task:** Create a comprehensive stock profile with the following sections. CRITICAL: Summarize each descriptive section in 2000 characters or less.

1. **BUSINESS_MODEL**
2. **MOATS**
3. **COMPETITIVE_ADVANTAGES**
4. **COMPETITIVE_LANDSCAPE**
5. **MANAGEMENT_QUALITY**
6. **VALUATION_FRAMEWORK**
7. **FUNDAMENTALS_SUMMARY**
8. **RISKS**
9. **CATALYSTS**
10. **METADATA** (required)

Use clear section headers and include recent risks/catalysts from the provided context.`;
}

async function benchmarkSymbol(symbol) {
  const result = { symbol };
  const startedAt = Date.now();
  try {
    const fundamentalsStart = Date.now();
    const fundamentals = await fmp.getFundamentals(symbol);
    result.fundamentals_seconds = Number(((Date.now() - fundamentalsStart) / 1000).toFixed(1));

    const formatDate = (date) => date.toISOString().split('T')[0];
    const historyStart = Date.now();
    const historicalData = await fmp.getHistoricalPriceEodFull(
      symbol,
      formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)),
      formatDate(new Date())
    );
    result.history_seconds = Number(((Date.now() - historyStart) / 1000).toFixed(1));

    const newsStart = Date.now();
    const news = await tavily.searchStructuredStockContext(symbol, {
      maxResults: 5,
      depth: 'advanced',
      topic: 'news',
      timeRange: 'month'
    });
    result.news_seconds = Number(((Date.now() - newsStart) / 1000).toFixed(1));
    result.news_results = news.length;

    const prompt = buildPrompt(symbol, fundamentals, historicalData, news);
    const modelStart = Date.now();
    const research = await claude.sendMessage(
      [{ role: 'user', content: prompt }],
      MODELS.GEMINI_PRO,
      null,
      false,
      20000
    );
    result.model_seconds = Number(((Date.now() - modelStart) / 1000).toFixed(1));

    const text = research?.content?.map(block => block?.text || '').join('\n').trim() || '';
    const parsed = parseResearchIntoProfile(symbol, text, fundamentals);

    result.total_seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    result.risks_len = parsed.risks.length;
    result.catalysts_len = parsed.catalysts.length;
    result.business_model_len = parsed.business_model.length;
    result.market_cap_category = parsed.market_cap_category;
    result.metadata_present = parsed.metadata_present;
    result.risks_preview = parsed.risks.slice(0, 140);
    result.catalysts_preview = parsed.catalysts.slice(0, 140);
    return result;
  } catch (error) {
    result.total_seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    result.error = error.message;
    return result;
  }
}

async function main() {
  const results = [];
  for (const symbol of symbols) {
    console.log(`\n=== Benchmarking ${symbol} ===`);
    const result = await benchmarkSymbol(symbol);
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
