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
    {
      label: 'catalysts',
      query: [
        `${symbol} analyst estimates`,
        `${symbol} guidance`,
        `${symbol} product launch`,
        `${symbol} partnership`,
        `${symbol} regulation`,
        `${symbol} catalyst`
      ].join(' OR '),
      options: {
        depth: 'advanced',
        topic: 'news',
        timeRange: 'month',
        maxResults: 4,
        includeDomains: SEARCH_DOMAINS
      }
    },
    {
      label: 'positioning',
      query: [
        `${symbol} insider buying`,
        `${symbol} insider selling`,
        `${symbol} analyst upgrade`,
        `${symbol} analyst downgrade`,
        `${symbol} industry trends ${pathway || ''}`.trim()
      ].join(' OR '),
      options: {
        depth: 'basic',
        topic: 'news',
        timeRange: 'month',
        maxResults: 3,
        includeDomains: SEARCH_DOMAINS
      }
    }
  ];

  const results = [];
  for (const search of searches) {
    try {
      const searchResults = await tavily.search(search.query, search.options);
      results.push({ query: search.label, results: searchResults || [] });
    } catch (error) {
      results.push({ query: search.label, results: [], error: error.message });
    }
  }

  return results;
}

export default {
  detectCatalysts,
  researchCatalysts
};
