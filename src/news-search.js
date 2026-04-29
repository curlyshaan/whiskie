import axios from 'axios';
import cheerio from 'cheerio';
import dotenv from 'dotenv';
import * as db from './db.js';
import claude, { MODELS } from './claude.js';
import serper from './serper.js';

dotenv.config();

const ARTICLE_TIMEOUT_MS = Number(process.env.NEWS_ARTICLE_TIMEOUT_MS || 15000);
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

  async fetchArticle(url) {
    if (!url) return null;

    try {
      const response = await axios.get(url, {
        timeout: ARTICLE_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Whiskie/1.0; +https://github.com/curlyshaan/whiskie)'
        },
        responseType: 'text',
        maxRedirects: 5
      });

      const articleText = this.normalizeArticleText(response.data);
      if (!articleText) return null;
      return {
        url,
        articleText
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
      return `${index + 1}. ${result.title}
   Source: ${result.source || 'Unknown'} — ${result.url}
   Summary: ${result.summary || result.content || 'No summary available.'}
   Published: ${result.published_date || 'Recent'}${bulletText}`;
    }).join('\n\n');
  }
}

export default new NewsSearchService();
