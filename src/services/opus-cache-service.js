class OpusCacheService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 4 * 60 * 60 * 1000;
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp >= this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return cached.value;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
    return value;
  }

  buildKey(parts = {}) {
    return JSON.stringify(parts);
  }
}

export default new OpusCacheService();
