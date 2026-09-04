import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateCartTotal,
  BudgetExceededError,
  InsufficientStockError,
  ProductNotFoundError
} from '../src/services/pricing.js';
import { resetStore, getProductById } from '../src/data/store.js';

describe('Deterministic Financial Pricing Guardrails', () => {
  beforeEach(() => {
    resetStore();
  });

  it('calculates correct subtotal for a single valid product', () => {
    // Desk Pad is ₹899 = 89,900 paise
    const result = calculateCartTotal([{ productId: 'prod_desk_pad', quantity: 2 }]);

    expect(result.totalPaise).toBe(179800); // 89,900 * 2 = 179,800 paise (₹1,798.00)
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('prod_desk_pad');
    expect(result.items[0].pricePaise).toBe(89900);
    expect(result.items[0].unitPricePaise).toBe(89900);
    expect(result.items[0].subtotalPaise).toBe(179800);
    expect(result.withinBudget).toBe(true);
  });

  it('calculates correct subtotal for multiple distinct valid products', () => {
    // Ergonomic Cushion: 189,900 paise * 1 = 189,900
    // Smart LED Lamp: 229,900 paise * 2 = 459,800
    // Total: 649,700 paise (₹6,497.00)
    const result = calculateCartTotal([
      { productId: 'prod_ergo_cushion', quantity: 1 },
      { productId: 'prod_led_lamp', quantity: 2 }
    ]);

    expect(result.totalPaise).toBe(649700);
    expect(result.items).toHaveLength(2);
    expect(result.totalINR).toBe('₹6,497.00');
    expect(result.items[0].subtotalPaise).toBe(189900);
    expect(result.items[1].subtotalPaise).toBe(459800);
  });

  it('throws an error when purchasing out-of-stock items', () => {
    // Noise-canceling headset initial stock is 12
    const product = getProductById('prod_nc_headset');
    expect(product).toBeDefined();
    expect(product!.stock).toBe(12);

    expect(() => {
      calculateCartTotal([{ productId: 'prod_nc_headset', quantity: 25 }]);
    }).toThrowError(InsufficientStockError);

    try {
      calculateCartTotal([{ productId: 'prod_nc_headset', quantity: 25 }]);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InsufficientStockError);
      expect(err.productId).toBe('prod_nc_headset');
      expect(err.requested).toBe(25);
      expect(err.available).toBe(12);
    }
  });

  it('strictly throws BudgetExceededError when total exceeds maxBudgetPaise', () => {
    // Mechanical Keyboard: 649,900 paise (₹6,499)
    // 2 x Keyboard = 1,299,800 paise (₹12,998)
    // Budget ceiling set to ₹10,000 = 1,000,000 paise
    expect(() => {
      calculateCartTotal([{ productId: 'prod_mech_keyboard', quantity: 2 }], 1000000);
    }).toThrowError(BudgetExceededError);

    try {
      calculateCartTotal([{ productId: 'prod_mech_keyboard', quantity: 2 }], 1000000);
    } catch (err: any) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect(err.totalPaise).toBe(1299800);
      expect(err.maxBudgetPaise).toBe(1000000);
      expect(err.excessPaise).toBe(299800);
      expect(err.message).toContain('Budget exceeded');
    }
  });

  it('allows checkout when total exactly matches the budget limit (boundary condition)', () => {
    // USB-C dock is 499,900 paise
    const result = calculateCartTotal([{ productId: 'prod_usbc_dock', quantity: 1 }], 499900);
    expect(result.totalPaise).toBe(499900);
    expect(result.withinBudget).toBe(true);
  });

  it('throws ProductNotFoundError for unknown product ID', () => {
    expect(() => {
      calculateCartTotal([{ productId: 'prod_non_existent_item', quantity: 1 }]);
    }).toThrowError(ProductNotFoundError);
  });

  it('rejects invalid or non-positive quantities', () => {
    expect(() => {
      calculateCartTotal([{ productId: 'prod_desk_pad', quantity: 0 }]);
    }).toThrowError(/positive integer/);

    expect(() => {
      calculateCartTotal([{ productId: 'prod_desk_pad', quantity: -2 }]);
    }).toThrowError(/positive integer/);
  });

  it('rejects empty cart arrays', () => {
    expect(() => {
      calculateCartTotal([]);
    }).toThrowError(/Cart is empty/);
  });
});
