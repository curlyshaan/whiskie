import tavily from './tavily.js';

const SEARCH_DOMAINS = [
  'seekingalpha.com',
  'finance.yahoo.com',
  'bloomberg.com',
  'reuters.com',
  'sec.gov',
  'fda.gov'
];

export function detectCatalysts(news = []) {
  const catalysts = [];
  const catalystKeywords = {
    'FDA approval': /FDA (approval|cleared|granted)/i,
    'Product launch': /launch(ing|ed)? (new )?product/i,
    'Earnings beat': /beat (earnings|estimates)/i,
    'Partnership': /(partnership|collaboration|deal) with/i,
    'Acquisition': /(acquir(e|ing|ed)|bought)/i,
    'Expansion': /(expand(ing|ed)|entering) (new )?(market|region)/i
  };

  for (const [catalyst, regex] of Object.entries(catalystKeywords)) {
    if (news.some(article => regex.test(`${article.title || ''} ${article.description || ''} ${article.content || ''}`))) {
      catalysts.push(catalyst);
    }
  }

  return catalysts;
}

export async function researchCatalysts(symbol, pathway) {
  const searches = [
    `${symbol} earnings date 2026`,
    `${symbol} analyst estimates consensus 2026`,
    `${symbol} product launch 2026`,
    `${symbol} partnership deal announcement 2026`,
    `${symbol} insider buying recent`,
    `${symbol} industry trends 2026 ${pathway || ''}`.trim()
  ];

  const results = [];
  for (const query of searches) {
    try {
      const searchResults = await tavily.search(query, {
        depth: 'advanced',
        maxResults: 3,
        includeDomains: SEARCH_DOMAINS
      });

      results.push({ query, results: searchResults || [] });
    } catch (error) {
      results.push({ query, results: [], error: error.message });
    }
  }

  return results;
}

export default {
  detectCatalysts,
  researchCatalysts
};
