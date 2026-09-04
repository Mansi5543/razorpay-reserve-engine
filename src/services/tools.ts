import { inventoryStore } from '../store/inventory.js';
import { calculateCartTotal, BudgetExceededError, InsufficientStockError, ProductNotFoundError } from './pricing.js';

export interface SearchProductsArgs {
  query?: string;
  maxBudgetPaise?: number;
}

export interface CheckAvailabilityArgs {
  productId: string;
  quantity?: number;
}

export interface GenerateManifestArgs {
  items: Array<{ productId: string; quantity: number }>;
  maxBudgetPaise?: number;
}

/**
 * Tool 1: searchProducts
 * Searches the workshop inventory catalog
 */
export function handleSearchProducts(args: SearchProductsArgs) {
  const products = inventoryStore.searchProducts(args.query, args.maxBudgetPaise);
  return {
    count: products.length,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      priceINR: `₹${(p.pricePaise / 100).toFixed(2)}`,
      pricePaise: p.pricePaise,
      inStock: p.stock > 0,
      stockCount: p.stock
    }))
  };
}

/**
 * Tool 2: checkAvailability
 * Checks inventory stock and returns exact unit price
 */
export function handleCheckAvailability(args: CheckAvailabilityArgs) {
  const product = inventoryStore.getProductById(args.productId);
  if (!product) {
    return {
      found: false,
      error: `Product with ID '${args.productId}' not found in catalog.`
    };
  }

  const requestedQty = args.quantity && args.quantity > 0 ? Math.floor(args.quantity) : 1;
  const isAvailable = product.stock >= requestedQty;

  return {
    found: true,
    id: product.id,
    name: product.name,
    availableStock: product.stock,
    requestedQuantity: requestedQty,
    isAvailable,
    priceINR: `₹${(product.pricePaise / 100).toFixed(2)}`,
    pricePaise: product.pricePaise,
    statusMessage: isAvailable
      ? `In stock. ${product.stock} units available.`
      : `Out of stock / insufficient stock. Only ${product.stock} units remaining.`
  };
}

/**
 * Tool 3: generateOrderManifest
 * Strictly delegates pricing & budget checks to deterministic guardrails
 */
export function handleGenerateOrderManifest(args: GenerateManifestArgs) {
  try {
    const manifest = calculateCartTotal(args.items, args.maxBudgetPaise);
    return {
      success: true,
      manifest,
      message: `Order manifest successfully validated. Total: ${manifest.totalINR} (${manifest.totalPaise} paise).`
    };
  } catch (error: any) {
    if (error instanceof BudgetExceededError) {
      return {
        success: false,
        errorType: 'BUDGET_EXCEEDED',
        errorMessage: error.message,
        totalPaise: error.totalPaise,
        maxBudgetPaise: error.maxBudgetPaise,
        excessPaise: error.excessPaise
      };
    }
    if (error instanceof InsufficientStockError) {
      return {
        success: false,
        errorType: 'INSUFFICIENT_STOCK',
        errorMessage: error.message,
        productId: error.productId,
        requested: error.requested,
        available: error.available
      };
    }
    if (error instanceof ProductNotFoundError) {
      return {
        success: false,
        errorType: 'PRODUCT_NOT_FOUND',
        errorMessage: error.message
      };
    }

    return {
      success: false,
      errorType: 'VALIDATION_ERROR',
      errorMessage: error.message || 'Unknown pricing error'
    };
  }
}

/**
 * Tool Declarations for Gemini Function Calling
 */
export const geminiToolDeclarations = [
  {
    name: 'searchProducts',
    description:
      'Search the workshop inventory for hardware products, tools, development boards, and kits. Can filter by keyword and maximum budget in paise.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search keyword (e.g., "esp32", "arduino", "raspberry pi", "multimeter", "sensors").'
        },
        maxBudgetPaise: {
          type: 'NUMBER',
          description: 'Optional budget ceiling in integer paise (e.g. ₹1000 = 100000 paise).'
        }
      }
    }
  },
  {
    name: 'checkAvailability',
    description:
      'Check if a specific product is in stock and verify its real price.',
    parameters: {
      type: 'OBJECT',
      properties: {
        productId: {
          type: 'STRING',
          description: 'The exact product ID (e.g., "prod_esp32", "prod_rpi5").'
        },
        quantity: {
          type: 'NUMBER',
          description: 'The desired purchase quantity (default is 1).'
        }
      },
      required: ['productId']
    }
  },
  {
    name: 'generateOrderManifest',
    description:
      'Validates cart items and calculates exact server-verified total in integer paise against financial guardrails. Fails with BUDGET_EXCEEDED if the total breaches maxBudgetPaise.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'List of items to purchase with exact product IDs and quantities.',
          items: {
            type: 'OBJECT',
            properties: {
              productId: {
                type: 'STRING',
                description: 'The product ID.'
              },
              quantity: {
                type: 'NUMBER',
                description: 'Quantity to purchase.'
              }
            },
            required: ['productId', 'quantity']
          }
        },
        maxBudgetPaise: {
          type: 'NUMBER',
          description: 'The user maximum budget ceiling in integer paise.'
        }
      },
      required: ['items']
    }
  }
];
