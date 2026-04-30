import axios from 'axios';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import dotenv from 'dotenv';
import * as db from './db.js';
import claude, { MODELS } from './claude.js';
import serper from './serper.js';

dotenv.config();

const ARTICLE_TIMEOUT_MS = Number(process.env.NEWS_ARTICLE_TIMEOUT_MS || 15000);
const DEFAULT_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1'
};
const SUMMARY_MODEL = (() => {
  const configured = String(process.env.NEWS_SUMMARY_MODEL || '').trim();
  if (!configured) return MODELS.SONNET;
  return Object.values(MODELS).includes(configured) ? configured : MODELS.SONNET;
})();

class NewsSearchService {
  constructor() {
    this.summaryCache = new Map();
    this.summaryCacheTtlMs = Number(process.env.NEWS_SUMMARY_CACHE_TTL_MS || 30 * 60 * 1000);
  }

  buildCacheKey(url) {
    return String(url || '').trim();
  }

  getCachedSummary(url) {
    const cacheKey = this.buildCacheKey(url);
    const cached = this.summaryCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.summaryCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  setCachedSummary(url, value) {
    const cacheKey = this.buildCacheKey(url);
    this.summaryCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.summaryCacheTtlMs
    });
  }

  normalizeArticleText(html = '') {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, svg, nav, footer, header, form, aside').remove();

    const candidates = [
      'article',
      '[role="article"]',
      'main',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.story-body',
      '.caas-body',
      '.article-content'
    ];

    let bestText = '';
    for (const selector of candidates) {
      const text = $(selector).text().replace(/\s+/g, ' ').trim();
      if (text.length > bestText.length) bestText = text;
    }

    if (!bestText) {
      bestText = $('body').text().replace(/\s+/g, ' ').trim();
    }

    return bestText.slice(0, 12000);
  }

  extractReadableArticle(html = '', url = '') {
    try {
      const dom = new JSDOM(html, { url: url || 'https://example.com/' });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();
      const text = String(parsed?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        articleText: text.slice(0, 12000),
        title: parsed?.title || null,
        excerpt: parsed?.excerpt || null,
        byline: parsed?.byline || null,
        siteName: parsed?.siteName || null
      };
    } catch {
      return null;
    }
  }

  scoreExtractionQuality(articleText = '', html = '') {
    const text = String(articleText || '').trim();
    const lower = text.toLowerCase();
    if (!text) return 'empty';
    if (text.length < 200) return 'too_short';
    if (
      text.length < 1200
      && (
        lower.includes('subscriber agreement')
        || lower.includes('for your personal, non-commercial use only')
        || lower.includes('distribution and use of this material are governed')
        || lower.includes('copyright law')
      )
    ) {
      return 'paywall_stub';
    }
    const htmlLower = String(html || '').slice(0, 4000).toLowerCase();
    if (
      this.looksBlocked(htmlLower, text)
      && text.length < 1200
    ) {
      return 'blocked';
    }
    if (text.length < 1200) return 'partial';
    return 'good';
  }

  looksBlocked(html = '', extractedText = '') {
    const text = String(html || '').slice(0, 4000).toLowerCase();
    const normalizedExtracted = String(extractedText || '').trim();
    if (!text) return true;
    const blocked = [
      'access denied',
      'just a moment',
      'captcha',
      'verify you are human',
      'enable javascript and cookies to continue',
      'request unsuccessful',
      'please enable cookies',
      'security check'
    ].some(fragment => text.includes(fragment));

    if (!blocked) return false;
    return normalizedExtracted.length < 1200;
  }

  buildArticleHeaders(url = '') {
    const headers = { ...DEFAULT_BROWSER_HEADERS };
    try {
      const parsed = new URL(url);
      const origin = `${parsed.protocol}//${parsed.hostname}`;
      headers.Referer = origin;
      headers.Origin = origin;
    } catch {
      // ignore malformed URL
    }
    return headers;
  }

  normalizePublisherName(source = '', url = '') {
    const explicit = String(source || '').trim();
    if (explicit) return explicit;
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  getBestAvailableArticleText(result = {}) {
    return String(
      result.articleText
      || result.summary
      || result.content
      || ''
    ).trim();
  }

  async fetchArticle(url) {
    if (!url) return null;

    try {
      const response = await axios.get(url, {
        timeout: ARTICLE_TIMEOUT_MS,
        headers: this.buildArticleHeaders(url),
        responseType: 'text',
        maxRedirects: 5
      });

      const readabilityResult = this.extractReadableArticle(response.data, url);
      const cheerioText = this.normalizeArticleText(response.data);
      const articleText = readabilityResult?.articleText || cheerioText;
      const extractionQuality = this.scoreExtractionQuality(articleText, response.data);

      if (extractionQuality === 'blocked') {
        console.warn(`News article fetch blocked for ${url}: publisher challenge detected`);
        return null;
      }
      if (!articleText) return null;
      return {
        url,
        articleText,
        extractionQuality,
        extractedTitle: readabilityResult?.title || null,
        extractedExcerpt: readabilityResult?.excerpt || null,
        extractedByline: readabilityResult?.byline || null,
        extractedSiteName: readabilityResult?.siteName || null
      };
    } catch (error) {
      console.warn(`News article fetch failed for ${url}:`, error.message);
      return null;
    }
  }

  async summarizeArticle(result, options = {}) {
    const cached = this.getCachedSummary(result.url);
    if (cached) return cached;

    const fetched = await this.fetchArticle(result.url);
    const articleText = fetched?.articleText || result.content || '';

    if (!articleText.trim()) {
      const fallback = {
        ...result,
        articleText: '',
        summary: result.content || 'No summary available.',
        bullets: []
      };
      this.setCachedSummary(result.url, fallback);
      return fallback;
    }

    const prompt = `You are Whiskie's financial news summarizer.

Summarize this article for a portfolio management system.

Rules:
- Focus only on investable implications.
- Preserve material facts, not fluff.
- If the article is not clearly about the target company/topic, say that.
- Keep it concise and structured.

Return exactly:
SUMMARY: one concise paragraph
BULLETS:
- bullet 1
- bullet 2
- bullet 3

Title: ${result.title || 'Unknown'}
Source: ${result.source || 'Unknown'}
Published: ${result.published_date || 'Unknown'}
URL: ${result.url}

Article text:
${articleText}`;

    try {
      const response = await claude.sendMessage(
        [{ role: 'user', content: prompt }],
        SUMMARY_MODEL,
        null,
        false,
        0,
        { quiet: true, maxTokens: 1200 }
      );
      const text = response?.content?.find(block => block.type === 'text')?.text || '';
      const summary = text.match(/SUMMARY:\s*([\s\S]*?)(?:BULLETS:|$)/i)?.[1]?.trim() || result.content || '';
      const bullets = (text.match(/BULLETS:\s*([\s\S]*)$/i)?.[1] || '')
        .split('\n')
        .map(line => line.trim().replace(/^-\s*/, ''))
        .filter(Boolean)
        .slice(0, 4);

      const normalized = {
        ...result,
        source: this.normalizePublisherName(result.source, result.url),
        articleText,
        extractionQuality: fetched?.extractionQuality || (result.content ? 'snippet_only' : 'empty'),
        extractedTitle: fetched?.extractedTitle || null,
        extractedExcerpt: fetched?.extractedExcerpt || null,
        extractedByline: fetched?.extractedByline || null,
        extractedSiteName: fetched?.extractedSiteName || null,
        summary,
        bullets
      };
      this.setCachedSummary(result.url, normalized);
      return normalized;
    } catch (error) {
      console.warn(`News summary failed for ${result.url}:`, error.message);
      const fallback = {
        ...result,
        source: this.normalizePublisherName(result.source, result.url),
        articleText,
        extractionQuality: fetched?.extractionQuality || (result.content ? 'snippet_only' : 'empty'),
        extractedTitle: fetched?.extractedTitle || null,
        extractedExcerpt: fetched?.extractedExcerpt || null,
        extractedByline: fetched?.extractedByline || null,
        extractedSiteName: fetched?.extractedSiteName || null,
        summary: result.content || 'No summary available.',
        bullets: []
      };
      this.setCachedSummary(result.url, fallback);
      return fallback;
    }
  }

  async enrichResults(results = [], options = {}) {
    const limit = Math.min(Number(options.fetchFullArticles ?? 3), results.length);
    const enriched = [];

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result) continue;
      if (index < limit) {
        enriched.push(await this.summarizeArticle(result, options));
      } else {
        enriched.push({
          ...result,
          source: this.normalizePublisherName(result.source, result.url),
          articleText: '',
          extractionQuality: result.content ? 'snippet_only' : 'empty',
          extractedTitle: null,
          extractedExcerpt: null,
          extractedByline: null,
          extractedSiteName: null,
          summary: result.content || 'No summary available.',
          bullets: []
        });
      }
    }

    return enriched;
  }

  async search(query, options = {}) {
    const results = await serper.search(query, options);
    return await this.enrichResults(results, options);
  }

  async searchWithFallbacks(queryBuilders = [], baseOptions = {}) {
    const results = await serper.searchWithFallbacks(queryBuilders, baseOptions);
    return await this.enrichResults(results, baseOptions);
  }

  async searchMany(queries = [], baseOptions = {}) {
    const results = await serper.searchMany(queries, baseOptions);
    return await this.enrichResults(results, baseOptions);
  }

  async searchStockNews(symbol, maxResults = 5, options = {}) {
    const results = await serper.searchStockNews(symbol, maxResults, options);
    return await this.enrichResults(results, options);
  }

  async searchMarketNews(maxResults = 5, options = {}) {
    const results = await serper.searchMarketNews(maxResults, options);
    return await this.enrichResults(results, options);
  }

  async searchNews(query, maxResults = 5, options = {}) {
    const results = await serper.searchNews(query, maxResults, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredStockContext(symbol, options = {}) {
    const results = await serper.searchStructuredStockContext(symbol, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredProfileContext(symbol, options = {}) {
    const results = await serper.searchStructuredProfileContext(symbol, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredMonitoringContext(symbol, options = {}) {
    const results = await serper.searchStructuredMonitoringContext(symbol, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredEarningsContext(symbol, options = {}) {
    const results = await serper.searchStructuredEarningsContext(symbol, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredPremarketContext(symbol, options = {}) {
    const results = await serper.searchStructuredPremarketContext(symbol, options);
    return await this.enrichResults(results, options);
  }

  async searchStructuredMacroContext(options = {}) {
    const results = await serper.searchStructuredMacroContext(options);
    return await this.enrichResults(results, options);
  }


  async getStructuredStockContextWithHealth(symbol, options = {}) {
    return await serper.getHealthAwareResults(
      () => this.searchStructuredStockContext(symbol, options),
      { ...options, symbol, activity: 'stock_context' }
    );
  }

  async getStructuredProfileContextWithHealth(symbol, options = {}) {
    return await serper.getHealthAwareResults(
      () => this.searchStructuredProfileContext(symbol, options),
      { ...options, symbol, activity: 'profile_context' }
    );
  }

  async getStructuredMacroContextWithHealth(options = {}) {
    return await serper.getHealthAwareResults(
      () => this.searchStructuredMacroContext(options),
      { ...options, activity: 'macro_context' }
    );
  }

  async getStructuredEarningsContextWithHealth(symbol, options = {}) {
    return await serper.getHealthAwareResults(
      () => this.searchStructuredEarningsContext(symbol, options),
      { ...options, symbol, activity: 'earnings_context' }
    );
  }

  async getStructuredPremarketContextWithHealth(symbol, options = {}) {
    return await serper.getHealthAwareResults(
      () => this.searchStructuredPremarketContext(symbol, options),
      { ...options, symbol, activity: 'premarket_context' }
    );
  }

  async searchSectorNews(sector, maxResults = 3, options = {}) {
    const results = await serper.searchSectorNews(sector, maxResults, options);
    return await this.enrichResults(results, options);
  }

  formatResults(results) {
    if (!results || results.length === 0) {
      return 'No recent news found.';
    }

    return results.map((result, index) => {
      const bulletText = Array.isArray(result.bullets) && result.bullets.length
        ? `\n   Key points: ${result.bullets.join(' | ')}`
        : '';
      const bestSummary = result.summary || this.getBestAvailableArticleText(result) || 'No summary available.';
      return `${index + 1}. ${result.title}
   Source: ${result.source || 'Unknown'} — ${result.url}
   Summary: ${bestSummary}
   Published: ${result.published_date || 'Recent'}${bulletText}`;
    }).join('\n\n');
  }
}

export default new NewsSearchService();
