#!/usr/bin/env python3
"""
Fetch earnings dates using yfinance library
More reliable than web scraping Yahoo Finance HTML
"""

import yfinance as yf
import psycopg2
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in environment")
    sys.exit(1)

def get_all_stocks():
    """Get all stock symbols from sub-industry data"""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Get unique symbols from the stocks we track
    # For now, just use a hardcoded list of common stocks
    # You can expand this to read from your sub-industry-data.js
    stocks = [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B',
        'V', 'JPM', 'JNJ', 'WMT', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV',
        'KO', 'PEP', 'COST', 'AVGO', 'TMO', 'MCD', 'CSCO', 'ACN', 'LIN',
        'ABT', 'DHR', 'NKE', 'TXN', 'NEE', 'PM', 'UNP', 'RTX', 'COP',
        'QCOM', 'HON', 'UPS', 'INTU', 'LOW', 'SPGI', 'AMD', 'SBUX', 'GS',
        'BA', 'CAT', 'DE', 'AXP', 'BLK', 'GILD', 'MDLZ', 'ADI', 'ISRG',
        'LMT', 'MMC', 'CI', 'BKNG', 'SYK', 'VRTX', 'PLD', 'REGN', 'ZTS',
        'CB', 'DUK', 'SO', 'TGT', 'BMY', 'SCHW', 'MO', 'PGR', 'EOG',
        'CL', 'ITW', 'HUM', 'BDX', 'APD', 'SLB', 'GD', 'NOC', 'TJX',
        'USB', 'AON', 'CME', 'ICE', 'PNC', 'MCO', 'CCI', 'NSC', 'ETN'
    ]

    conn.close()
    return stocks

def fetch_earnings_date(symbol):
    """Fetch earnings date for a symbol using yfinance"""
    try:
        ticker = yf.Ticker(symbol)

        # Get earnings dates
        earnings_dates = ticker.earnings_dates

        if earnings_dates is None or len(earnings_dates) == 0:
            return None, None

        # Get the next upcoming earnings date
        # Convert datetime.now() to timezone-aware to match pandas DatetimeIndex
        from datetime import timezone
        now = datetime.now(timezone.utc)

        # Filter for future dates
        future_dates = earnings_dates[earnings_dates.index >= now]

        if len(future_dates) == 0:
            return None, None

        # Get the first future date
        next_earnings = future_dates.index[0]
        earnings_date = next_earnings.strftime('%Y-%m-%d')

        # Try to determine if BMO or AMC
        # yfinance doesn't always provide this, so default to unknown
        earnings_time = 'unknown'

        return earnings_date, earnings_time

    except Exception as e:
        print(f"Error fetching {symbol}: {str(e)}")
        return None, None

def upsert_earning(symbol, earnings_date, earnings_time):
    """Insert or update earnings date in database"""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO earnings_calendar (symbol, earnings_date, earnings_time, last_updated)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (symbol, earnings_date)
            DO UPDATE SET
                earnings_time = %s,
                last_updated = CURRENT_TIMESTAMP
        """, (symbol, earnings_date, earnings_time, earnings_time))

        conn.commit()
    except Exception as e:
        print(f"Database error for {symbol}: {str(e)}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

def main():
    print("📅 Starting earnings update using yfinance...")

    stocks = get_all_stocks()
    print(f"Total stocks to update: {len(stocks)}")

    success_count = 0
    fail_count = 0
    found_count = 0

    for i, symbol in enumerate(stocks):
        try:
            earnings_date, earnings_time = fetch_earnings_date(symbol)

            if earnings_date:
                upsert_earning(symbol, earnings_date, earnings_time)
                found_count += 1
                print(f"✅ {symbol}: {earnings_date} ({earnings_time})")
            else:
                print(f"⚠️ {symbol}: No earnings date found")

            success_count += 1

            # Progress update every 20 stocks
            if (i + 1) % 20 == 0:
                print(f"Progress: {i + 1}/{len(stocks)} ({found_count} earnings dates found)")

        except Exception as e:
            print(f"❌ {symbol}: {str(e)}")
            fail_count += 1

    print("\n📊 Earnings Update Summary:")
    print(f"Total stocks: {len(stocks)}")
    print(f"Success: {success_count}")
    print(f"Failed: {fail_count}")
    print(f"Earnings dates found: {found_count}")
    print("✅ Earnings update complete!")

if __name__ == "__main__":
    main()
