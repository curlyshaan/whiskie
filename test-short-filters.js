import overvaluedScreener from './src/overvalued-screener.js';

const stocks = ['PLTR', 'SOFI', 'IREN', 'OKLO'];

console.log('Testing Short Strategy Filters\n');
console.log('='.repeat(80));

for (const symbol of stocks) {
  console.log(`\n📊 ${symbol}`);
  console.log('-'.repeat(80));

  try {
    const data = await overvaluedScreener.getStockData(symbol);

    if (!data) {
      console.log('❌ No quote data available');
      continue;
    }

    console.log(`Price: $${data.price}`);
    console.log(`Spread: ${data.spread}%`);
    console.log(`Change Today: ${data.change}%`);
    console.log(`Volume Surge: ${data.volumeSurge}x`);
    console.log(`Extended from 52w High: ${data.extendedFromHigh}%`);

    if (data.shortData) {
      console.log(`\n🔍 Short Squeeze Risk:`);
      console.log(`   Short Float: ${(data.shortData.shortFloat * 100).toFixed(1)}%`);
      console.log(`   Days to Cover: ${data.shortData.daysToCover.toFixed(1)}`);

      // Apply short-manager rules
      if (data.shortData.shortFloat > 0.30) {
        console.log(`   ❌ BLOCKED: Short float >30% - extreme squeeze risk`);
      } else if (data.shortData.shortFloat > 0.20) {
        console.log(`   ⚠️  WARNING: Short float >20% - elevated squeeze risk, max 3% position`);
      } else if (data.shortData.shortFloat > 0.15) {
        console.log(`   ⚠️  WARNING: Short float >15% - moderate squeeze risk`);
      } else {
        console.log(`   ✅ Short float acceptable`);
      }

      if (data.shortData.daysToCover > 5) {
        console.log(`   ❌ BLOCKED: Days to cover >5 - extreme squeeze risk`);
      } else if (data.shortData.daysToCover >= 4) {
        console.log(`   ⚠️  WARNING: Days to cover >=4 - max 8% position`);
      } else {
        console.log(`   ✅ Days to cover acceptable`);
      }
    } else {
      console.log(`\n⚠️  Short interest data unavailable`);
    }

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

console.log(`\n${'='.repeat(80)}`);
