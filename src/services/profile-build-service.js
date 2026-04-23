import * as db from '../db.js';
import stockProfiles, { getProfileFreshness } from '../stock-profiles.js';

class ProfileBuildService {
  constructor() {
    this.activeBuilds = new Map();
  }

  hasActiveBuild(symbol) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    return this.activeBuilds.has(normalizedSymbol);
  }

  async ensureFreshProfile(symbol, options = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!normalizedSymbol) {
      throw new Error('Symbol is required');
    }

    if (this.activeBuilds.has(normalizedSymbol)) {
      return this.activeBuilds.get(normalizedSymbol);
    }

    const buildPromise = this.#runBuild(normalizedSymbol, options)
      .finally(() => this.activeBuilds.delete(normalizedSymbol));

    this.activeBuilds.set(normalizedSymbol, buildPromise);
    return buildPromise;
  }

  async #runBuild(symbol, options) {
    const staleAfterDays = options.staleAfterDays == null ? 14 : Number(options.staleAfterDays);
    const existing = await db.getLatestStockProfile(symbol).catch(() => null);
    const freshness = getProfileFreshness(existing, staleAfterDays);

    if (freshness.hasProfile && !freshness.isStale) {
      return {
        action: 'reused',
        profile: existing
      };
    }

    const profile = await stockProfiles.ensureFreshStockProfile(symbol, options);
    return {
      action: profile?.action || (freshness.hasProfile ? 'refreshed' : 'built'),
      profile
    };
  }
}

export default new ProfileBuildService();
