#!/bin/bash

# Reset Railway PostgreSQL Database
# Run this script to clear all trading data tables

echo "🗑️  Resetting Railway database..."
echo ""

# Use Railway CLI to run the reset script
railway run node scripts/reset-database-clean.js

echo ""
echo "✅ Railway database reset complete"
