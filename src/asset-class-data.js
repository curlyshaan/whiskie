/**
 * GICS Asset Class Classification
 * 11 GICS sectors for portfolio allocation
 *
 * Replaces 41 sub-industry system to prevent concentration risk
 * (e.g., prevents 60% tech exposure via 30% semiconductors + 30% software)
 */

export const ASSET_CLASSES = {
  "Technology": [
    // Semiconductors
    "NVDA", "TSM", "AVGO", "AMD", "ASML", "QCOM", "INTC", "MU", "TXN", "AMAT", "CBRS",
    // Software & SaaS
    "MSFT", "ORCL", "CRM", "ADBE", "NOW", "INTU", "SNPS", "CDNS", "WDAY", "TEAM", "PLTR",
    // Cloud Computing
    "SNOW", "NET", "DDOG", "MDB", "CFLT", "ESTC", "DBX",
    // Cybersecurity
    "PANW", "CRWD", "ZS", "FTNT", "S", "OKTA", "TENB", "CYBR", "QLYS",
    // IT Hardware & Networking
    "AAPL", "CSCO", "HPE", "HPQ", "DELL", "NTAP", "JNPR", "SMCI", "PSTG", "ZBRA", "GRMN",
    // Quantum Computing
    "IONQ", "RGTI",
    // IT Services
    "ACN", "IBM", "FI", "FIS", "FISV", "GDDY", "EPAM", "GLOB", "LDOS", "CRWV"
  ],

  "Communication Services": [
    // Digital Advertising & Social Media
    "META", "GOOGL", "SNAP", "PINS", "TTD", "DV", "ROKU", "RDDT",
    // Streaming & Entertainment
    "NFLX", "DIS", "WBD", "PARA", "SPOT", "IMAX", "NWSA", "FOXA",
    // Video Gaming
    "EA", "TTWO", "RBLX", "U", "DKNG", "PENN", "GLBE",
    // Telecom
    "T", "VZ", "TMUS", "IRDM", "LBRDK", "CHTR"
  ],

  "Healthcare": [
    // Biotechnology
    "LLY", "ABBV", "AMGN", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "ALNY", "BMRN", "EIKN", "GENB", "EXEL", "AXSM",
    // Pharmaceuticals
    "JNJ", "MRK", "PFE", "BMY", "ZTS", "VTRS", "OGN", "JAZZ", "NBIX",
    // Medical Devices
    "ABT", "MDT", "SYK", "BSX", "ISRG", "EW", "BDX", "ZBH", "BAX", "HOLX",
    // Healthcare Services
    "UNH", "ELV", "CVS", "CI", "HCA", "HUM", "CNC", "MOH", "THC", "UHS",
    // Life Sciences
    "TMO", "DHR", "A", "IQV", "ILMN", "MTD", "PKI", "BIO", "CRL", "TECH"
  ],

  "Financials": [
    // Banks
    "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC", "SCHW",
    // Insurance
    "BRK.B", "PGR", "CB", "MMC", "AON", "AJG", "MET", "AFL", "PRU", "TRV",
    // Fintech & Payments
    "V", "MA", "PYPL", "SQ", "FI", "GPN", "AFRM", "BILL", "FOUR", "SOFI", "FIS",
    // Asset Management
    "BLK", "KKR", "APO", "ARES", "BX", "OWL", "TROW", "IVZ", "BEN", "AMG",
    // Financial Data
    "SPGI", "ICE", "CME", "MSCI", "CBOE", "MCO", "NDAQ", "MKTX", "VIRT", "HOOD"
  ],

  "Industrials": [
    // Aerospace & Defense
    "RTX", "BA", "LMT", "GD", "NOC", "LHX", "TDG", "HWM", "HEI", "TXT", "KTOS", "RKLB",
    // Industrial Machinery
    "CAT", "DE", "GE", "EMR", "ROK", "ETN", "PH", "ITW", "DOV", "AME",
    // Transportation & Logistics
    "UNP", "UPS", "FDX", "CSX", "NSC", "UBER", "ODFL", "XPO", "JBHT", "CHRW",
    // Building Products
    "SHW", "JCI", "CARR", "LII", "MAS", "OC", "BLDR", "VMC", "MLM", "EXP",
    // Electrical Equipment
    "GNRC", "HUBB", "AYI", "POWL", "GEV", "VRT", "SMR"
  ],

  "Consumer Discretionary": [
    // E-commerce & Online Retail
    "AMZN", "SHOP", "EBAY", "ETSY", "W", "CHWY", "CVNA", "BKNG", "ABNB", "DASH",
    // Restaurants
    "MCD", "SBUX", "CMG", "YUM", "QSR", "DRI", "CAVA", "WING", "DPZ", "SG",
    // Automotive & EV
    "TSLA", "GM", "F", "RIVN", "LCID", "APTV", "BWA", "VC", "LEA", "ALV", "NIO", "LI", "XPEV",
    // Retail & Apparel
    "HD", "LOW", "TJX", "NKE", "ROST", "LULU", "DECK", "TPR", "BURL", "GPS", "COST",
    // Travel & Leisure
    "MAR", "HLT", "EXPE", "RCL", "CCL", "NCLH", "H", "LVS"
  ],

  "Consumer Staples": [
    // Food & Beverage
    "KO", "PEP", "PM", "MDLZ", "KHC", "GIS", "K", "HSY", "CAG", "SJM", "MNST", "CELH",
    // Household Products
    "PG", "CL", "KMB", "CHD", "EL", "CLX", "SPB", "ENR", "COTY", "EPC",
    // Grocery & Retail
    "WMT", "COST", "TGT", "KR", "DG", "DLTR", "SYY", "ACI", "BJ", "GO"
  ],

  "Energy": [
    // Oil & Gas E&P
    "XOM", "CVX", "COP", "EOG", "DVN", "FANG", "MPC", "PSX", "VLO", "HON", "CCJ",
    // Oil & Gas Services
    "SLB", "HAL", "BKR", "WMB", "KMI", "OKE", "TRGP", "ET", "LNG", "DTM",
    // Renewable Energy
    "NEE", "FSLR", "RUN", "BE", "ORA", "CWEN", "AES", "IREN", "OKLO", "BEP"
  ],

  "Utilities": [
    // Electric Utilities
    "DUK", "SO", "D", "AEP", "EXC", "SRE", "XEL", "ED", "WEC", "CEG", "VST",
    // Water & Gas
    "AWK", "ATO", "NI", "CMS", "ES", "FE", "PEG"
  ],

  "Real Estate": [
    // REITs
    "PLD", "AMT", "EQIX", "PSA", "DLR", "O", "WELL", "AVB", "EQR", "SPG", "CCI",
    // Real Estate Services
    "CBRE", "Z", "RDFN", "OPEN", "COMP"
  ],

  "Materials": [
    // Chemicals
    "LIN", "APD", "ECL", "DD", "DOW", "PPG", "SHW", "NEM", "FCX", "ALB",
    // Metals & Mining
    "NUE", "STLD", "CLF", "X", "AA"
  ]
};

/**
 * Base allocation limits for each asset class (%)
 * These are adjusted dynamically based on rate environment and VIX regime
 */
export const BASE_LIMITS = {
  "Technology": 0.30,              // 30% base
  "Communication Services": 0.20,  // 20% base
  "Healthcare": 0.25,              // 25% base
  "Financials": 0.25,              // 25% base
  "Industrials": 0.20,             // 20% base
  "Consumer Discretionary": 0.20,  // 20% base
  "Consumer Staples": 0.20,        // 20% base
  "Energy": 0.20,                  // 20% base
  "Utilities": 0.15,               // 15% base
  "Real Estate": 0.15,             // 15% base
  "Materials": 0.20                // 20% base
};

/**
 * Rate environment multipliers
 * Applied to base limits based on current interest rate environment
 */
export const RATE_MULTIPLIERS = {
  "LOW_RATES": {  // Fed Funds <3%
    "Technology": 1.20,              // 30% → 36%
    "Communication Services": 1.15,  // 20% → 23%
    "Healthcare": 1.00,              // 25% → 25%
    "Financials": 0.85,              // 25% → 21%
    "Industrials": 1.00,             // 20% → 20%
    "Consumer Discretionary": 1.15,  // 20% → 23%
    "Consumer Staples": 1.00,        // 20% → 20%
    "Energy": 1.00,                  // 20% → 20%
    "Utilities": 1.00,               // 15% → 15%
    "Real Estate": 1.00,             // 15% → 15%
    "Materials": 1.00                // 20% → 20%
  },
  "NEUTRAL_RATES": {  // Fed Funds 3-5%
    "Technology": 1.00,
    "Communication Services": 1.00,
    "Healthcare": 1.00,
    "Financials": 1.00,
    "Industrials": 1.00,
    "Consumer Discretionary": 1.00,
    "Consumer Staples": 1.00,
    "Energy": 1.00,
    "Utilities": 1.00,
    "Real Estate": 1.00,
    "Materials": 1.00
  },
  "HIGH_RATES": {  // Fed Funds >5% or rising rapidly
    "Technology": 0.80,              // 30% → 24%
    "Communication Services": 0.90,  // 20% → 18%
    "Healthcare": 1.00,              // 25% → 25%
    "Financials": 1.25,              // 25% → 31%
    "Industrials": 1.00,             // 20% → 20%
    "Consumer Discretionary": 0.85,  // 20% → 17%
    "Consumer Staples": 1.15,        // 20% → 23%
    "Energy": 1.25,                  // 20% → 25%
    "Utilities": 1.00,               // 15% → 15%
    "Real Estate": 0.70,             // 15% → 10%
    "Materials": 1.10                // 20% → 22%
  }
};

/**
 * VIX regime multipliers (stacks with rate multipliers)
 * Applied on top of rate-adjusted limits
 */
export const VIX_MULTIPLIERS = {
  "CALM": {      // VIX <15
    "Technology": 1.00,
    "Communication Services": 1.00,
    "Healthcare": 1.00,
    "Financials": 1.00,
    "Industrials": 1.00,
    "Consumer Discretionary": 1.00,
    "Consumer Staples": 1.00,
    "Energy": 1.00,
    "Utilities": 1.00,
    "Real Estate": 1.00,
    "Materials": 1.00
  },
  "NORMAL": {    // VIX 15-20
    "Technology": 1.00,
    "Communication Services": 1.00,
    "Healthcare": 1.00,
    "Financials": 1.00,
    "Industrials": 1.00,
    "Consumer Discretionary": 1.00,
    "Consumer Staples": 1.00,
    "Energy": 1.00,
    "Utilities": 1.00,
    "Real Estate": 1.00,
    "Materials": 1.00
  },
  "ELEVATED": {  // VIX 20-28
    "Technology": 0.90,
    "Communication Services": 0.90,
    "Healthcare": 1.10,
    "Financials": 0.95,
    "Industrials": 0.90,
    "Consumer Discretionary": 0.90,
    "Consumer Staples": 1.10,
    "Energy": 0.95,
    "Utilities": 1.10,
    "Real Estate": 0.85,
    "Materials": 0.90
  },
  "FEAR": {      // VIX 28-35
    "Technology": 0.85,
    "Communication Services": 0.85,
    "Healthcare": 1.00,
    "Financials": 0.90,
    "Industrials": 0.85,
    "Consumer Discretionary": 0.85,
    "Consumer Staples": 1.00,
    "Energy": 0.90,
    "Utilities": 1.00,
    "Real Estate": 0.80,
    "Materials": 0.85
  },
  "PANIC": {     // VIX >35
    "Technology": 0.85,
    "Communication Services": 0.85,
    "Healthcare": 1.00,
    "Financials": 0.85,
    "Industrials": 0.85,
    "Consumer Discretionary": 0.85,
    "Consumer Staples": 1.00,
    "Energy": 0.85,
    "Utilities": 1.00,
    "Real Estate": 0.75,
    "Materials": 0.85
  }
};

/**
 * Hard limits (emergency brakes)
 */
export const HARD_LIMITS = {
  MAX_ASSET_CLASS_ALLOCATION: 0.40,  // No asset class >40% ever
  MAX_STOCKS_PER_ASSET_CLASS: 4,     // Max 4 stocks per asset class (prevents 48% concentration)
  MIN_ASSET_CLASSES: 3               // Minimum 3 asset classes represented
};

/**
 * Get asset class for a given stock symbol
 */
export function getAssetClass(symbol) {
  for (const [assetClass, stocks] of Object.entries(ASSET_CLASSES)) {
    if (stocks.includes(symbol)) {
      return assetClass;
    }
  }
  return "Unknown";
}

/**
 * Get all stocks in an asset class
 */
export function getStocksInAssetClass(assetClass) {
  return ASSET_CLASSES[assetClass] || [];
}

/**
 * Get all asset classes
 */
export function getAllAssetClasses() {
  return Object.keys(ASSET_CLASSES);
}

export default {
  ASSET_CLASSES,
  BASE_LIMITS,
  RATE_MULTIPLIERS,
  VIX_MULTIPLIERS,
  HARD_LIMITS,
  getAssetClass,
  getStocksInAssetClass,
  getAllAssetClasses
};
