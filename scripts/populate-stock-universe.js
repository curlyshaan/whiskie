import * as db from '../src/db.js';
import { SUB_INDUSTRIES, getAllStocks } from '../src/sub-industry-data.js';

/**
 * Populate stock_universe table from sub-industry-data.js
 * Run once to initialize the database with all stocks
 */

// GICS Sector mapping
const SECTOR_MAP = {
  "Cloud Computing": "Information Technology",
  "Cybersecurity": "Information Technology",
  "Semiconductors": "Information Technology",
  "Software & SaaS": "Information Technology",
  "IT Hardware & Networking": "Information Technology",
  "IT Services & Consulting": "Information Technology",
  "E-commerce & Online Retail": "Consumer Discretionary",
  "Digital Advertising & Social Media": "Communication Services",
  "Streaming & Digital Entertainment": "Communication Services",
  "Video Gaming & Esports": "Communication Services",
  "Telecom Services": "Communication Services",
  "Biotechnology": "Health Care",
  "Pharmaceuticals": "Health Care",
  "Medical Devices & Equipment": "Health Care",
  "Health Care Services & Managed Care": "Health Care",
  "Life Sciences Tools & Diagnostics": "Health Care",
  "Banks & Diversified Financials": "Financials",
  "Insurance": "Financials",
  "Fintech & Payments": "Financials",
  "Asset Management & Capital Markets": "Financials",
  "Financial Data & Exchanges": "Financials",
  "Aerospace & Defense": "Industrials",
  "Industrial Machinery & Equipment": "Industrials",
  "Transportation & Logistics": "Industrials",
  "Building Products & Construction": "Industrials",
  "Electrical Equipment & Automation": "Industrials",
  "Restaurants & Food Services": "Consumer Discretionary",
  "Automotive & EV": "Consumer Discretionary",
  "Retail & Apparel": "Consumer Discretionary",
  "Travel & Leisure": "Consumer Discretionary",
  "Food & Beverage": "Consumer Staples",
  "Household & Personal Products": "Consumer Staples",
  "Grocery & Consumer Retail": "Consumer Staples",
  "Oil & Gas Exploration & Production": "Energy",
  "Renewable Energy & Clean Tech": "Utilities",
  "Oil & Gas Services & Midstream": "Energy",
  "Electric Utilities": "Utilities",
  "Water & Gas Utilities": "Utilities",
  "REITs & Real Estate": "Real Estate",
  "Specialty & Industrial REITs": "Real Estate",
  "Chemicals & Specialty Materials": "Materials",
  "Metals & Mining": "Materials"
};

async function populateStockUniverse() {
  try {
    console.log('🚀 Starting stock universe population...');

    let totalStocks = 0;
    let successCount = 0;
    let errorCount = 0;

    // Iterate through all sub-industries
    for (const [subIndustry, stocks] of Object.entries(SUB_INDUSTRIES)) {
      const sector = SECTOR_MAP[subIndustry];

      console.log(`\n📊 Processing ${subIndustry} (${stocks.length} stocks)...`);

      for (const symbol of stocks) {
        totalStocks++;

        try {
          await db.upsertStockUniverse({
            symbol,
            sector,
            sub_industry: subIndustry,
            market_cap_tier: 'large-cap', // Default, will be updated by ETB check
            shortable: false // Will be updated by ETB verification
          });

          successCount++;
          process.stdout.write('.');
        } catch (error) {
          errorCount++;
          console.error(`\n❌ Error adding ${symbol}: ${error.message}`);
        }
      }
    }

    console.log('\n\n✅ Stock universe population complete!');
    console.log(`📈 Total stocks processed: ${totalStocks}`);
    console.log(`✅ Successfully added: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    // Get unique count
    const allStocks = getAllStocks();
    console.log(`🎯 Unique stocks in universe: ${allStocks.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
populateStockUniverse();
