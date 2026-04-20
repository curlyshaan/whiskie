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
  const [catalystResults, positioningResults] = await Promise.allSettled([
    tavily.searchStructuredStockContext(symbol, {
      maxResults: 4,
      depth: 'advanced',
      topic: 'news',
      timeRange: 'month',
      includeDomains: SEARCH_DOMAINS
    }),
    tavily.searchStructuredMonitoringContext(symbol, {
      maxResults: 3,
      depth: 'basic',
      topic: 'news',
      timeRange: 'month',
      includeDomains: SEARCH_DOMAINS
    })
  ]);

  return [
    {
      query: 'catalysts',
      results: catalystResults.status === 'fulfilled' ? (catalystResults.value || []) : [],
      error: catalystResults.status === 'rejected' ? catalystResults.reason?.message : undefined
    },
    {
      query: 'positioning',
      results: positioningResults.status === 'fulfilled' ? (positioningResults.value || []) : [],
      error: positioningResults.status === 'rejected' ? positioningResults.reason?.message : undefined
    }
  ];
}

export default {
  detectCatalysts,
  researchCatalysts
};
