class RegionalPricing {
  constructor() {
    // Base prices in USD
    this.basePrices = {
      photo_plan: 9.99,
      media_plan: 29.99
    };

    // Regional pricing multipliers and currency codes
    this.regions = {
      'HK': { currency: 'HKD', multiplier: 7.8, name: 'Hong Kong' },
      'CN': { currency: 'CNY', multiplier: 7.2, name: 'China' },
      'JP': { currency: 'JPY', multiplier: 150, name: 'Japan' },
      'SG': { currency: 'SGD', multiplier: 1.35, name: 'Singapore' },
      'AU': { currency: 'AUD', multiplier: 1.5, name: 'Australia' },
      'GB': { currency: 'GBP', multiplier: 0.8, name: 'United Kingdom' },
      'EU': { currency: 'EUR', multiplier: 0.92, name: 'Europe' },
      'CA': { currency: 'CAD', multiplier: 1.35, name: 'Canada' },
      'US': { currency: 'USD', multiplier: 1.0, name: 'United States' },
      'default': { currency: 'USD', multiplier: 1.0, name: 'International' }
    };

    // Convenient rounding rules by currency
    this.roundingRules = {
      'HKD': { round: 10, pattern: [50, 80, 100, 200, 300, 500] },
      'CNY': { round: 5, pattern: [25, 50, 75, 100, 200, 300] },
      'JPY': { round: 100, pattern: [500, 1000, 1500, 2000, 3000, 5000] },
      'SGD': { round: 1, pattern: [5, 10, 15, 20, 25, 50] },
      'AUD': { round: 1, pattern: [5, 10, 15, 20, 25, 50] },
      'GBP': { round: 1, pattern: [5, 8, 10, 15, 25, 50] },
      'EUR': { round: 1, pattern: [5, 9, 10, 15, 25, 50] },
      'CAD': { round: 1, pattern: [5, 10, 15, 20, 25, 50] },
      'USD': { round: 0.99, pattern: [4.99, 9.99, 14.99, 19.99, 29.99, 49.99] }
    };
  }

  // Detect region from IP address (simplified version)
  detectRegion(ip, countryCode = null) {
    // If country code is provided, use it
    if (countryCode) {
      // Map some common country codes to regions
      if (['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT'].includes(countryCode)) {
        return 'EU';
      }
      return this.regions[countryCode] ? countryCode : 'default';
    }

    // For demo purposes, detect based on common IP patterns
    if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return 'default'; // Local/private IP
    }

    // In production, you'd use a proper IP geolocation service
    // For now, return default
    return 'default';
  }

  // Round to convenient numbers based on currency
  roundPrice(price, currency) {
    const rules = this.roundingRules[currency] || this.roundingRules['USD'];
    
    if (rules.pattern) {
      // Find the closest pattern price
      let closest = rules.pattern[0];
      let minDiff = Math.abs(price - closest);
      
      for (const pattern of rules.pattern) {
        const diff = Math.abs(price - pattern);
        if (diff < minDiff) {
          minDiff = diff;
          closest = pattern;
        }
      }
      return closest;
    }

    // Fallback to simple rounding
    const roundTo = rules.round;
    return Math.round(price / roundTo) * roundTo;
  }

  // Get regional pricing for all plans
  getRegionalPricing(region = 'default', countryCode = null) {
    const detectedRegion = region === 'auto' ? this.detectRegion(null, countryCode) : region;
    const regionInfo = this.regions[detectedRegion] || this.regions['default'];

    const photoPlanPrice = this.basePrices.photo_plan * regionInfo.multiplier;
    const mediaPlanPrice = this.basePrices.media_plan * regionInfo.multiplier;

    // Special handling for HK as requested
    if (detectedRegion === 'HK') {
      return {
        region: detectedRegion,
        currency: regionInfo.currency,
        regionName: regionInfo.name,
        plans: {
          free_trial: { price: 0, currency: regionInfo.currency },
          photo_plan: { price: 100, currency: regionInfo.currency }, // 100 HKD as requested
          media_plan: { price: 300, currency: regionInfo.currency }   // 300 HKD as requested
        }
      };
    }

    return {
      region: detectedRegion,
      currency: regionInfo.currency,
      regionName: regionInfo.name,
      plans: {
        free_trial: { price: 0, currency: regionInfo.currency },
        photo_plan: { 
          price: this.roundPrice(photoPlanPrice, regionInfo.currency), 
          currency: regionInfo.currency 
        },
        media_plan: { 
          price: this.roundPrice(mediaPlanPrice, regionInfo.currency), 
          currency: regionInfo.currency 
        }
      }
    };
  }

  // Format price for display
  formatPrice(price, currency) {
    const formatters = {
      'USD': (p) => `$${p}`,
      'HKD': (p) => `HK$${p}`,
      'CNY': (p) => `¥${p}`,
      'JPY': (p) => `¥${p}`,
      'SGD': (p) => `S$${p}`,
      'AUD': (p) => `A$${p}`,
      'GBP': (p) => `£${p}`,
      'EUR': (p) => `€${p}`,
      'CAD': (p) => `C$${p}`
    };

    const formatter = formatters[currency] || formatters['USD'];
    return formatter(price);
  }

  // Get currency symbol
  getCurrencySymbol(currency) {
    const symbols = {
      'USD': '$', 'HKD': 'HK$', 'CNY': '¥', 'JPY': '¥',
      'SGD': 'S$', 'AUD': 'A$', 'GBP': '£', 'EUR': '€', 'CAD': 'C$'
    };
    return symbols[currency] || '$';
  }
}

module.exports = RegionalPricing;