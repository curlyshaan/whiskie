#!/usr/bin/env python3
"""
Python Yahoo Finance Microservice
Provides REST API wrapper around yfinance for Node.js integration
Run: python3 python-yahoo-service.py
"""

from flask import Flask, jsonify, request
import yfinance as yf
from datetime import datetime

app = Flask(__name__)

@app.route('/fundamentals/<symbol>', methods=['GET'])
def get_fundamentals(symbol):
    """Get comprehensive fundamental data for a symbol"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        return jsonify({
            'symbol': symbol,
            'companyName': info.get('longName', symbol),
            'sector': info.get('sector', 'Unknown'),
            'industry': info.get('industry', 'Unknown'),
            'marketCap': info.get('marketCap', 0),

            # Valuation
            'peRatio': info.get('trailingPE', 0),
            'forwardPE': info.get('forwardPE', 0),
            'pegRatio': info.get('pegRatio', 0),
            'priceToBook': info.get('priceToBook', 0),
            'priceToSales': info.get('priceToSalesTrailing12Months', 0),

            # Growth
            'revenueGrowth': info.get('revenueGrowth', 0),
            'earningsGrowth': info.get('earningsGrowth', 0),

            # Financial health
            'debtToEquity': info.get('debtToEquity', 0),
            'currentRatio': info.get('currentRatio', 0),
            'quickRatio': info.get('quickRatio', 0),

            # Profitability
            'operatingMargin': info.get('operatingMargins', 0),
            'profitMargin': info.get('profitMargins', 0),
            'roe': info.get('returnOnEquity', 0),
            'roa': info.get('returnOnAssets', 0),

            # Cash flow
            'freeCashflow': info.get('freeCashflow', 0),
            'operatingCashflow': info.get('operatingCashflow', 0),

            # Price
            'price': info.get('currentPrice', 0),
            'beta': info.get('beta', 0),
            'fiftyTwoWeekHigh': info.get('fiftyTwoWeekHigh', 0),
            'fiftyTwoWeekLow': info.get('fiftyTwoWeekLow', 0),

            # Analyst data
            'targetMeanPrice': info.get('targetMeanPrice', 0),
            'targetHighPrice': info.get('targetHighPrice', 0),
            'targetLowPrice': info.get('targetLowPrice', 0),
            'numberOfAnalysts': info.get('numberOfAnalystOpinions', 0),
            'recommendationKey': info.get('recommendationKey', 'none')
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/quote/<symbol>', methods=['GET'])
def get_quote(symbol):
    """Get real-time quote data"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        return jsonify({
            'symbol': symbol,
            'price': info.get('currentPrice', 0),
            'change': info.get('regularMarketChange', 0),
            'changePercent': info.get('regularMarketChangePercent', 0),
            'volume': info.get('volume', 0),
            'avgVolume': info.get('averageVolume', 0),
            'marketCap': info.get('marketCap', 0),
            'high': info.get('dayHigh', 0),
            'low': info.get('dayLow', 0),
            'open': info.get('open', 0),
            'previousClose': info.get('previousClose', 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/earnings/<symbol>', methods=['GET'])
def get_earnings(symbol):
    """Get earnings history and estimates"""
    try:
        ticker = yf.Ticker(symbol)
        earnings = ticker.earnings
        quarterly_earnings = ticker.quarterly_earnings

        return jsonify({
            'annual': earnings.to_dict('records') if earnings is not None else [],
            'quarterly': quarterly_earnings.to_dict('records') if quarterly_earnings is not None else []
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'python-yahoo-finance'})

if __name__ == '__main__':
    print('🐍 Python Yahoo Finance Service starting on http://localhost:5001')
    app.run(host='0.0.0.0', port=5001, debug=False)
