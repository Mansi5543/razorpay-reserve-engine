import { getProductById } from '../data/store.js';

export class BudgetExceededError extends Error {
  public readonly totalPaise: number;
  public readonly maxBudgetPaise: number;
  public readonly excessPaise: number;

  constructor(totalPaise: number, maxBudgetPaise: number) {
    const excessPaise = totalPaise - maxBudgetPaise;
    const totalINR = (totalPaise / 100).toFixed(2);
    const budgetINR = (maxBudgetPaise / 100).toFixed(2);
    const excessINR = (excessPaise / 100).toFixed(2);
    super(
      `Budget exceeded: Cart total of ₹${totalINR} (${totalPaise} paise) exceeds maximum budget of ₹${budgetINR} (${maxBudgetPaise} paise) by ₹${excessINR} (${excessPaise} paise).`
    );
    this.name = 'BudgetExceededError';
    this.totalPaise = totalPaise;
    this.maxBudgetPaise = maxBudgetPaise;
    this.excessPaise = excessPaise;
  }
}

export class InsufficientStockError extends Error {
  public readonly productId: string;
  public readonly requested: number;
  public readonly available: number;

  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient stock for product '${productId}': Requested ${requested}, but only ${available} available.`
    );
    this.name = 'InsufficientStockError';
    this.productId = productId;
    this.requested = requested;
    this.available = available;
  }
}

export class ProductNotFoundError extends Error {
  public readonly productId: string;

  constructor(productId: string) {
    super(`Product with ID '${productId}' was not found in catalog.`);
    this.name = 'ProductNotFoundError';
    this.productId = productId;
  }
}

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface CalculatedCartItem {
  productId: string;
  name: string;
  quantity: number;
  pricePaise: number;
  unitPricePaise: number;
  subtotalPaise: number;
}

export interface CartCalculationResult {
  items: CalculatedCartItem[];
  totalPaise: number;
  totalINR: string;
  withinBudget: boolean;
  maxBudgetPaise?: number;
  currency: 'INR';
}

/**
 * Deterministic Financial Pricing Engine
 *
 * Under NO circumstances does the LLM compute or manipulate prices.
 * All totals are calculated in exact integer paise based on authoritative catalog data.
 */
export function calculateCartTotal(
  items: Array<{ productId: string; quantity: number }>,
  maxBudgetPaise?: number,
  customStore?: { getProductById: (id: string) => any }
): CartCalculationResult {
  if (!items || items.length === 0) {
    throw new Error('Cart is empty. At least one item must be provided.');
  }

  const calculatedItems: CalculatedCartItem[] = [];
  let totalPaise = 0;

  for (const item of items) {
    if (!item.productId || typeof item.productId !== 'string') {
      throw new Error('Invalid item: productId is required and must be a string.');
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid quantity for product '${item.productId}': must be a positive integer.`);
    }

    const product = customStore
      ? customStore.getProductById(item.productId.trim())
      : getProductById(item.productId.trim());

    if (!product) {
      throw new ProductNotFoundError(item.productId);
    }

    if (item.quantity > product.stock) {
      throw new InsufficientStockError(product.id, item.quantity, product.stock);
    }

    const unitPricePaise = Math.round(product.pricePaise);
    const subtotalPaise = unitPricePaise * item.quantity;
    totalPaise += subtotalPaise;

    calculatedItems.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      pricePaise: unitPricePaise,
      unitPricePaise,
      subtotalPaise
    });
  }

  // Strict Financial Guardrail: Enforce budget ceiling
  if (typeof maxBudgetPaise === 'number' && maxBudgetPaise > 0) {
    if (totalPaise > maxBudgetPaise) {
      throw new BudgetExceededError(totalPaise, maxBudgetPaise);
    }
  }

  return {
    items: calculatedItems,
    totalPaise,
    totalINR: `₹${(totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    withinBudget: typeof maxBudgetPaise === 'number' ? totalPaise <= maxBudgetPaise : true,
    maxBudgetPaise,
    currency: 'INR'
  };
}
