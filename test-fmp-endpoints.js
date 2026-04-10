import fmp from './src/fmp.js';
import advancedFMPScreener from './src/advanced-fmp-screener.js';

/**
 * FMP Stable API Endpoint Test Suite
 * Tests all endpoints to document which work on free plan vs require paid subscription
 */

const API_KEY = '4WeyS0aP8qcZE7MncNLbUfUYeP3d3Y6z';
const BASE = 'https://financialmodelingprep.com/stable';
const TEST_SYMBOL = 'NOW';

const endpoints = [
  // Basic Company Data
  { category: 'Basic', name: 'Profile', path: '/profile?symbol=NOW', free: null },
  { category: 'Basic', name: 'Quote', path: '/quote?symbol=NOW', free: null },

  // Financial Statements
  { category: 'Financials', name: 'Income Statement', path: '/income-statement?symbol=NOW&period=annual&limit=1', free: null },
  { category: 'Financials', name: 'Balance Sheet', path: '/balance-sheet-statement?symbol=NOW&period=annual&limit=1', free: null },
  { category: 'Financials', name: 'Cash Flow', path: '/cash-flow-statement?symbol=NOW&period=annual&limit=1', free: null },

  // Metrics & Ratios
  { category: 'Metrics', name: 'Key Metrics', path: '/key-metrics?symbol=NOW&period=annual&limit=1', free: null },
  { category: 'Metrics', name: 'Financial Ratios', path: '/ratios?symbol=NOW&period=annual&limit=1', free: null },
  { category: 'Metrics', name: 'Financial Growth', path: '/financial-growth?symbol=NOW&period=annual&limit=1', free: null },

  // Phase 1 - Smart Money Signals
  { category: 'Phase 1', name: 'Insider Trading', path: '/insider-trading/latest?page=0&limit=10&symbol=NOW', free: null },
  { category: 'Phase 1', name: 'Institutional Ownership', path: '/institutional-ownership/latest?page=0&limit=10&symbol=NOW', free: null },
  { category: 'Phase 1', name: 'Analyst Estimates', path: '/analyst-estimates?symbol=NOW&period=quarter&limit=4', free: null },

  // Phase 2 - Quality & Sentiment
  { category: 'Phase 2', name: 'Earnings Surprises Bulk', path: '/earnings-surprises-bulk?year=2026', free: null },
  { category: 'Phase 2', name: 'Price Target', path: '/price-target/latest?page=0&limit=20&symbol=NOW', free: null },
  { category: 'Phase 2', name: 'Price Target Summary', path: '/price-target-summary?symbol=NOW', free: null },
  { category: 'Phase 2', name: 'Price Target Consensus', path: '/price-target-consensus?symbol=NOW', free: null },
];

async function testEndpoint(endpoint) {
  try {
    const url = `${BASE}${endpoint.path}&apikey=${API_KEY}`;
    const response = await fetch(url);
    const status = response.status;

    if (status === 200) {
      const data = await response.json();
      const hasData = Array.isArray(data) ? data.length > 0 : (data && Object.keys(data).length > 0);
      const count = Array.isArray(data) ? data.length : 1;
      endpoint.free = true;
      endpoint.status = 'FREE';
      endpoint.records = hasData ? count : 0;
      return { success: true, hasData, count };
    } else if (status === 402) {
      endpoint.free = false;
      endpoint.status = 'PAID';
      return { success: false, reason: 'Requires paid subscription' };
    } else if (status === 404) {
      endpoint.free = false;
      endpoint.status = 'NOT_FOUND';
      return { success: false, reason: 'Endpoint not found' };
    } else {
      endpoint.free = false;
      endpoint.status = `HTTP_${status}`;
      return { success: false, reason: `HTTP ${status}` };
    }
  } catch (error) {
    endpoint.free = false;
    endpoint.status = 'ERROR';
    return { success: false, reason: error.message };
  }
}

async function runTests() {
  console.log('FMP Stable API - Comprehensive Endpoint Test\n');
  console.log('Testing with API key:', API_KEY.substring(0, 8) + '...\n');
  console.log('='.repeat(80));

  // Test all endpoints
  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);

    const icon = endpoint.free === true ? '✅' :
                 endpoint.free === false ? '💰' : '⚠️';
    const status = endpoint.status || 'UNKNOWN';
    const records = endpoint.records ? ` (${endpoint.records} records)` : '';

    console.log(`${icon} ${endpoint.category.padEnd(12)} | ${endpoint.name.padEnd(30)} | ${status}${records}`);
  }

  console.log('='.repeat(80));

  // Summary by category
  console.log('\nSUMMARY BY CATEGORY:\n');

  const categories = [...new Set(endpoints.map(e => e.category))];
  for (const category of categories) {
    const categoryEndpoints = endpoints.filter(e => e.category === category);
    const free = categoryEndpoints.filter(e => e.free === true).length;
    const paid = categoryEndpoints.filter(e => e.free === false).length;
    const total = categoryEndpoints.length;

    console.log(`${category.padEnd(12)}: ${free}/${total} free, ${paid}/${total} paid`);
  }

  // Overall summary
  const totalFree = endpoints.filter(e => e.free === true).length;
  const totalPaid = endpoints.filter(e => e.free === false).length;
  const total = endpoints.length;

  console.log('\n' + '='.repeat(80));
  console.log(`OVERALL: ${totalFree}/${total} endpoints work on FREE plan`);
  console.log(`         ${totalPaid}/${total} endpoints require PAID subscription`);
  console.log('='.repeat(80));

  // Free endpoints list
  console.log('\n✅ FREE ENDPOINTS:');
  endpoints.filter(e => e.free === true).forEach(e => {
    console.log(`   - ${e.name} (${e.category})`);
  });

  // Paid endpoints list
  console.log('\n💰 PAID ENDPOINTS:');
  endpoints.filter(e => e.free === false && e.status === 'PAID').forEach(e => {
    console.log(`   - ${e.name} (${e.category})`);
  });

  // Not found endpoints
  const notFound = endpoints.filter(e => e.status === 'NOT_FOUND');
  if (notFound.length > 0) {
    console.log('\n❌ NOT FOUND:');
    notFound.forEach(e => {
      console.log(`   - ${e.name} (${e.category})`);
    });
  }

  // Test advanced screener methods
  console.log('\n' + '='.repeat(80));
  console.log('TESTING ADVANCED SCREENER METHODS:\n');

  try {
    console.log('Testing getInsiderTrading(NOW)...');
    const insider = await advancedFMPScreener.getInsiderTrading(TEST_SYMBOL);
    console.log(`✅ Insider Trading: ${insider.length} records`);
  } catch (error) {
    console.log(`❌ Insider Trading: ${error.message}`);
  }

  try {
    console.log('Testing getInstitutionalOwnership(NOW)...');
    const institutional = await advancedFMPScreener.getInstitutionalOwnership(TEST_SYMBOL);
    console.log(`✅ Institutional Ownership: ${institutional.length} records`);
  } catch (error) {
    console.log(`❌ Institutional Ownership: ${error.message}`);
  }

  try {
    console.log('Testing getAnalystEstimates(NOW)...');
    const estimates = await advancedFMPScreener.getAnalystEstimates(TEST_SYMBOL);
    console.log(`✅ Analyst Estimates: ${estimates.length} records`);
  } catch (error) {
    console.log(`❌ Analyst Estimates: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

// Run tests
runTests().catch(console.error);
