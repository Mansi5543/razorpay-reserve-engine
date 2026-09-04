import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  Product,
  Order,
  getProducts,
  getProductById,
  saveOrder
} from '../data/store.js';
import {
  calculateCartTotal,
  BudgetExceededError,
  InsufficientStockError,
  ProductNotFoundError
} from '../services/pricing.js';
import { createRazorpayOrder, getRazorpayKeyId } from '../services/razorpay.js';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const hasValidGeminiKey = Boolean(
  apiKey &&
  !apiKey.includes('placeholder') &&
  !apiKey.includes('your_') &&
  apiKey.length > 15
);

let aiClient: GoogleGenAI | null = null;
if (hasValidGeminiKey) {
  try {
    aiClient = new GoogleGenAI({ apiKey });
  } catch (err) {
    console.warn('[Gemini Commerce Agent] Initialization error:', err);
  }
}

export const SYSTEM_INSTRUCTION = `
You are the Apex Commerce Autonomous AI Shopping Agent for our professional desk setup and hardware store.
Your mission is to help customers explore high-quality workspace equipment, verify inventory levels and pricing, and seamlessly initiate checkout orders.

FINANCIAL GUARDRAIL POLICY (STRICT & ABSOLUTE):
1. Under NO circumstances do you calculate sums, discounts, subtotals, or final cart totals yourself.
2. The server-side pricing engine is the ONLY authoritative source of monetary truth. All prices are represented in integer paise (1 INR = 100 paise).
3. ALWAYS call the provided tools:
   - 'searchCatalog': To find products by keywords, categories, or description.
   - 'checkInventory': To check live stock levels and authentic unit price in paise for a product ID.
   - 'createCheckoutOrder': When the user expresses purchase intent or wants to buy items. This tool evaluates stock and enforces the customer's budget ceiling before creating the order.
4. If 'createCheckoutOrder' reports that the budget has been exceeded, explain the exact total versus budget to the user, and suggest adjusting item quantities or increasing their budget ceiling.
5. Provide helpful, professional, and clear responses.
`;

export const geminiToolDeclarations = [
  {
    name: 'searchCatalog',
    description: 'Searches the product catalog by keyword, product name, or category.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search term (e.g., "keyboard", "dock", "headset", "webcam", "lamp", "cushion", "arm", "pad").'
        }
      }
    }
  },
  {
    name: 'checkInventory',
    description: 'Checks real-time warehouse stock and exact unit price in integer paise for a product ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        productId: {
          type: 'STRING',
          description: 'The product ID to query (e.g., "prod_mech_keyboard", "prod_usbc_dock").'
        }
      },
      required: ['productId']
    }
  },
  {
    name: 'createCheckoutOrder',
    description: 'Deterministic checkout tool: validates stock, computes exact paise total, enforces maximum budget guardrails, registers a PENDING order, and initiates a Razorpay payment order.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'List of items to purchase with productId and quantity.',
          items: {
            type: 'OBJECT',
            properties: {
              productId: {
                type: 'STRING',
                description: 'The product ID to purchase.'
              },
              quantity: {
                type: 'NUMBER',
                description: 'Positive integer quantity.'
              }
            },
            required: ['productId', 'quantity']
          }
        }
      },
      required: ['items']
    }
  }
];

export interface SearchCatalogArgs {
  query?: string;
}

export interface CheckInventoryArgs {
  productId: string;
}

export interface CreateCheckoutOrderArgs {
  items: Array<{ productId: string; quantity: number }>;
}

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  razorpayOrderId?: string;
  totalPaise?: number;
  currency?: 'INR';
  checkoutUrl?: string | null;
  items?: any[];
  error?: string;
  errorType?: 'BUDGET_EXCEEDED' | 'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'VALIDATION_ERROR';
}

/**
 * Tool Handler: searchCatalog
 */
export function handleSearchCatalog(args: SearchCatalogArgs) {
  const products = getProducts(args.query);
  return {
    count: products.length,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      priceINR: `₹${(p.pricePaise / 100).toFixed(2)}`,
      pricePaise: p.pricePaise,
      stock: p.stock,
      inStock: p.stock > 0
    }))
  };
}

/**
 * Tool Handler: checkInventory
 */
export function handleCheckInventory(args: CheckInventoryArgs) {
  const product = getProductById(args.productId);
  if (!product) {
    return {
      found: false,
      error: `Product '${args.productId}' not found in catalog.`
    };
  }
  return {
    found: true,
    id: product.id,
    name: product.name,
    stock: product.stock,
    pricePaise: product.pricePaise,
    priceINR: `₹${(product.pricePaise / 100).toFixed(2)}`,
    inStock: product.stock > 0
  };
}

/**
 * Tool Handler: createCheckoutOrder
 */
export async function handleCreateCheckoutOrder(
  args: CreateCheckoutOrderArgs,
  maxBudgetPaise?: number
): Promise<CheckoutResult & { order?: Order }> {
  try {
    const calculation = calculateCartTotal(args.items, maxBudgetPaise);
    const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;

    const rzpOrder = await createRazorpayOrder(calculation.totalPaise, orderId);

    const pendingOrder: Order = {
      id: orderId,
      items: calculation.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        pricePaise: i.pricePaise
      })),
      totalPaise: calculation.totalPaise,
      razorpayOrderId: rzpOrder.id,
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };

    saveOrder(pendingOrder);

    return {
      success: true,
      orderId: pendingOrder.id,
      razorpayOrderId: rzpOrder.id,
      totalPaise: calculation.totalPaise,
      currency: 'INR',
      checkoutUrl: null,
      items: calculation.items,
      order: pendingOrder
    };
  } catch (err: any) {
    if (err instanceof BudgetExceededError) {
      return {
        success: false,
        errorType: 'BUDGET_EXCEEDED',
        error: err.message,
        totalPaise: err.totalPaise
      };
    }
    if (err instanceof InsufficientStockError) {
      return {
        success: false,
        errorType: 'INSUFFICIENT_STOCK',
        error: err.message
      };
    }
    if (err instanceof ProductNotFoundError) {
      return {
        success: false,
        errorType: 'PRODUCT_NOT_FOUND',
        error: err.message
      };
    }
    return {
      success: false,
      errorType: 'VALIDATION_ERROR',
      error: err.message || 'Error creating checkout order'
    };
  }
}

export interface CommerceAgentResult {
  response: string;
  reply: string;
  order?: Order;
  orderManifest?: {
    items: any[];
    totalPaise: number;
    totalINR: string;
    withinBudget: boolean;
    maxBudgetPaise?: number;
    currency: 'INR';
  };
  razorpayOrder?: {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
  };
  orderId?: string;
}

/**
 * Fallback reasoning engine when GEMINI_API_KEY is not configured
 */
async function runFallbackEngine(
  userMessage: string,
  maxBudgetPaise?: number
): Promise<CommerceAgentResult> {
  const lower = userMessage.toLowerCase();
  const allProducts = getProducts();

  // Intent: Check stock / inventory
  if (lower.includes('stock') || lower.includes('check') || lower.includes('have') || lower.includes('available')) {
    const matched = allProducts.find(
      (p) => lower.includes(p.name.toLowerCase()) || lower.includes(p.id.toLowerCase())
    );
    if (matched) {
      const inv = handleCheckInventory({ productId: matched.id });
      const text = `**${matched.name}** is currently **${inv.inStock ? 'in stock' : 'out of stock'}** with **${inv.stock} units available** at **${inv.priceINR}** (${inv.pricePaise} paise).`;
      return { response: text, reply: text };
    }
  }

  // Intent: Purchase / Order
  if (
    lower.includes('buy') ||
    lower.includes('order') ||
    lower.includes('purchase') ||
    lower.includes('checkout') ||
    lower.includes('get') ||
    lower.includes('cart')
  ) {
    const itemsToOrder: Array<{ productId: string; quantity: number }> = [];

    for (const p of allProducts) {
      const pNameLower = p.name.toLowerCase();
      // Match keywords or full name
      const keyword = pNameLower.split(' ').find((w) => w.length > 4 && lower.includes(w));
      if (lower.includes(pNameLower) || lower.includes(p.id.toLowerCase()) || keyword) {
        // Extract quantity if specified (e.g., "2 keyboards")
        const match = userMessage.match(new RegExp(`(\\d+)\\s*(?:x\\s*)?(?:${p.name}|${p.id}|${keyword})`, 'i'));
        const qty = match ? parseInt(match[1], 10) : 1;
        itemsToOrder.push({ productId: p.id, quantity: qty });
      }
    }

    if (itemsToOrder.length === 0) {
      // Default to first product if user said "buy" without naming specific item
      itemsToOrder.push({ productId: allProducts[0].id, quantity: 1 });
    }

    const checkoutRes = await handleCreateCheckoutOrder({ items: itemsToOrder }, maxBudgetPaise);

    if (!checkoutRes.success || !checkoutRes.order) {
      if (checkoutRes.errorType === 'BUDGET_EXCEEDED') {
        const text = `⚠️ **Budget Exceeded Guardrail Triggered!**\n\n${checkoutRes.error}\n\nThe deterministic pricing engine blocked checkout because the order total exceeds your authorized budget limit.`;
        return { response: text, reply: text };
      }
      const text = `⚠️ **Order Creation Failed**: ${checkoutRes.error}`;
      return { response: text, reply: text };
    }

    const order = checkoutRes.order;
    const totalINR = `₹${(order.totalPaise / 100).toFixed(2)}`;
    const itemsSummary = checkoutRes.items
      ?.map((i: any) => `• **${i.name}** × ${i.quantity} = ₹${(i.subtotalPaise / 100).toFixed(2)}`)
      .join('\n');

    const reply = `✅ **Checkout Order Created Successfully!**\n\n${itemsSummary}\n\n**Total**: ${totalINR} (${order.totalPaise} paise)\n**Order ID**: \`${order.id}\`\n**Razorpay Order**: \`${order.razorpayOrderId}\`\n\nYou can complete payment safely via the Razorpay Checkout modal.`;

    return {
      response: reply,
      reply,
      order,
      orderManifest: {
        items: checkoutRes.items || [],
        totalPaise: order.totalPaise,
        totalINR,
        withinBudget: true,
        maxBudgetPaise,
        currency: 'INR'
      },
      razorpayOrder: {
        orderId: order.razorpayOrderId!,
        amount: order.totalPaise,
        currency: 'INR',
        keyId: getRazorpayKeyId()
      },
      orderId: order.id
    };
  }

  // Default: Search catalog
  const catalog = handleSearchCatalog({ query: userMessage });
  if (catalog.products.length > 0) {
    const list = catalog.products
      .slice(0, 5)
      .map((p) => `• **${p.name}** (${p.id}): ${p.priceINR} | Stock: ${p.stock}\n  _${p.description}_`)
      .join('\n\n');
    const text = `Here are items from our catalog matching your request:\n\n${list}\n\nLet me know if you would like to inspect stock or create a checkout order!`;
    return { response: text, reply: text };
  }

  const defaultText = `I am your Apex Commerce AI Shopping Assistant. I can help you search items in our catalog (mechanical keyboard, USB-C dock, noise-canceling headset, 4K webcam, ergonomics cushion, monitor arm, desk pad, LED desk lamp), check stock, and place orders within your budget ceiling.`;
  return { response: defaultText, reply: defaultText };
}

/**
 * Main Agent Entrypoint: Executes LLM reasoning loop with Tool Declarations
 */
export async function runCommerceAgent(
  userMessage: string,
  maxBudgetPaise?: number
): Promise<CommerceAgentResult> {
  if (!hasValidGeminiKey || !aiClient) {
    return runFallbackEngine(userMessage, maxBudgetPaise);
  }

  try {
    const contextualMessage = maxBudgetPaise
      ? `${userMessage}\n\n[Financial Guardrail Context: Maximum Budget Ceiling is set to ₹${(maxBudgetPaise / 100).toFixed(2)} (${maxBudgetPaise} paise).]`
      : userMessage;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: contextualMessage }]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [
          {
            functionDeclarations: geminiToolDeclarations as any
          }
        ]
      }
    });

    const candidates = response.candidates || [];
    const firstCandidate = candidates[0];
    const parts = firstCandidate?.content?.parts || [];

    const toolCallPart = parts.find((p: any) => p.functionCall);
    let finalOrder: Order | undefined;
    let finalManifest: any = undefined;
    let finalRazorpayOrder: any = undefined;
    let finalReply = '';

    if (toolCallPart && toolCallPart.functionCall) {
      const call = toolCallPart.functionCall;
      const fnName = call.name;
      const fnArgs = (call.args as any) || {};

      let toolResult: any;

      if (fnName === 'searchCatalog') {
        toolResult = handleSearchCatalog(fnArgs);
      } else if (fnName === 'checkInventory') {
        toolResult = handleCheckInventory(fnArgs);
      } else if (fnName === 'createCheckoutOrder') {
        const orderRes = await handleCreateCheckoutOrder(fnArgs, maxBudgetPaise);
        toolResult = orderRes;
        if (orderRes.success && orderRes.order) {
          finalOrder = orderRes.order;
          finalManifest = {
            items: orderRes.items,
            totalPaise: orderRes.totalPaise,
            totalINR: `₹${((orderRes.totalPaise || 0) / 100).toFixed(2)}`,
            withinBudget: true,
            maxBudgetPaise,
            currency: 'INR'
          };
          finalRazorpayOrder = {
            orderId: orderRes.razorpayOrderId,
            amount: orderRes.totalPaise,
            currency: 'INR',
            keyId: getRazorpayKeyId()
          };
        }
      } else {
        toolResult = { error: `Unknown tool function: ${fnName}` };
      }

      // Complete reasoning loop by supplying function response back to Gemini
      const followUp = await aiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: contextualMessage }]
          },
          {
            role: 'model',
            parts: [{ functionCall: call }]
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: fnName,
                  response: toolResult
                }
              }
            ]
          }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION
        }
      });

      finalReply = followUp.text || 'Order inquiry processed.';
    } else {
      finalReply = response.text || 'Request processed.';
    }

    return {
      response: finalReply,
      reply: finalReply,
      order: finalOrder,
      orderManifest: finalManifest,
      razorpayOrder: finalRazorpayOrder,
      orderId: finalOrder?.id
    };
  } catch (error: any) {
    console.error('[Gemini Agent Error, falling back to deterministic engine]:', error);
    return runFallbackEngine(userMessage, maxBudgetPaise);
  }
}
