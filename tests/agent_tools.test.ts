import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleSearchCatalog,
  handleCheckInventory,
  handleCreateCheckoutOrder
} from '../src/agent/commerceAgent.js';
import { resetStore } from '../src/data/store.js';

describe('Gemini Agent Tools Execution', () => {
  beforeEach(() => {
    resetStore();
  });

  it('handleSearchCatalog finds matching products by query', () => {
    const searchResult = handleSearchCatalog({ query: 'keyboard' });
    expect(searchResult.count).toBeGreaterThan(0);
    expect(searchResult.products[0].id).toBe('prod_mech_keyboard');
    expect(searchResult.products[0].name).toContain('Mechanical Keyboard');
  });

  it('handleCheckInventory returns accurate live stock and paise unit price', () => {
    const inv = handleCheckInventory({ productId: 'prod_4k_webcam' });
    expect(inv.found).toBe(true);
    expect(inv.inStock).toBe(true);
    expect(inv.stock).toBe(15);
    expect(inv.pricePaise).toBe(549900);
    expect(inv.priceINR).toBe('₹5499.00');

    const notFound = handleCheckInventory({ productId: 'prod_unknown' });
    expect(notFound.found).toBe(false);
  });

  it('handleCreateCheckoutOrder validates stock and enforces budget limits', async () => {
    // Within budget: 1 Desk Pad (89,900 paise) + 1 Ergonomic Cushion (189,900 paise) = 279,800 paise
    const successRes = await handleCreateCheckoutOrder(
      {
        items: [
          { productId: 'prod_desk_pad', quantity: 1 },
          { productId: 'prod_ergo_cushion', quantity: 1 }
        ]
      },
      500000 // ₹5,000 budget
    );

    expect(successRes.success).toBe(true);
    expect(successRes.totalPaise).toBe(279800);
    expect(successRes.orderId).toBeDefined();
    expect(successRes.razorpayOrderId).toBeDefined();
    expect(successRes.order?.status).toBe('PENDING');

    // Over budget: Budget ₹2,000 (200,000 paise)
    const overBudgetRes = await handleCreateCheckoutOrder(
      {
        items: [
          { productId: 'prod_desk_pad', quantity: 1 },
          { productId: 'prod_ergo_cushion', quantity: 1 }
        ]
      },
      200000 // ₹2,000 budget
    );

    expect(overBudgetRes.success).toBe(false);
    expect(overBudgetRes.errorType).toBe('BUDGET_EXCEEDED');
    expect(overBudgetRes.totalPaise).toBe(279800);
  });
});
