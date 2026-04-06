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
    # Read from the JavaScript file and extract all unique symbols
    import re

    try:
        with open('src/sub-industry-data.js', 'r') as f:
            content = f.read()

        # Extract all arrays of stock symbols
        # Pattern matches: ["SYMBOL1", "SYMBOL2", ...]
        pattern = r'\[([^\]]+)\]'
        matches = re.findall(pattern, content)

        stocks = set()
        for match in matches:
            # Extract individual symbols from the array
            symbols = re.findall(r'"([A-Z][A-Z0-9.]*)"', match)
            stocks.update(symbols)

        return sorted(list(stocks))
    except Exception as e:
        print(f"Error reading sub-industry-data.js: {e}")
        print("Falling back to hardcoded list")
        # Fallback to a smaller list if file reading fails
        return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA']

def fetch_earnings_date(symbol):
    """Fetch earnings date for a symbol using yfinance"""
    try:
        ticker = yf.Ticker(symbol)

        # Get calendar data which includes earnings date
        calendar = ticker.calendar

        if calendar is None or not isinstance(calendar, dict):
            return None, None

        # Calendar returns a dict with 'Earnings Date' key
        if 'Earnings Date' in calendar:
            earnings_dates = calendar['Earnings Date']

            # earnings_dates is a list of datetime.date objects
            if isinstance(earnings_dates, list) and len(earnings_dates) > 0:
                # Get the first (next) earnings date
                next_earnings = earnings_dates[0]

                # Check if it's in the future
                from datetime import date
                if next_earnings >= date.today():
                    earnings_date = next_earnings.strftime('%Y-%m-%d')
                    return earnings_date, 'unknown'

        return None, None

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
