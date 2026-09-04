import { Router, Request, Response } from 'express';
import {
  getProducts,
  getOrderById,
  getOrderByRazorpayId,
  updateOrderStatus,
  decrementStock
} from '../data/store.js';
import { runCommerceAgent } from '../agent/commerceAgent.js';
import { verifyPaymentSignature, generateTestSignature, getRazorpayKeyId } from '../services/razorpay.js';

export const apiRouter = Router();

/**
 * GET /api/products
 * Fetch entire catalog with live stock counts
 */
apiRouter.get('/products', (_req: Request, res: Response) => {
  try {
    const products = getProducts();
    res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/orders/:id
 * Retrieve order details and status
 */
apiRouter.get('/orders/:id', (req: Request, res: Response) => {
  try {
    const order = getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/chat
 * Primary agentic conversation endpoint with budget guardrails
 * Accepts { message: string, budgetInr?: number }
 * Returns { response: string, order?: Order }
 */
apiRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, budgetInr, maxBudgetINR, maxBudgetPaise } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Field "message" is required and must be a string.'
      });
    }

    // Determine budget in integer paise
    let budgetInPaise: number | undefined;
    if (typeof maxBudgetPaise === 'number' && maxBudgetPaise > 0) {
      budgetInPaise = Math.round(maxBudgetPaise);
    } else if (typeof budgetInr === 'number' && budgetInr > 0) {
      budgetInPaise = Math.round(budgetInr * 100);
    } else if (typeof maxBudgetINR === 'number' && maxBudgetINR > 0) {
      budgetInPaise = Math.round(maxBudgetINR * 100);
    }

    const agentResult = await runCommerceAgent(message, budgetInPaise);

    res.json({
      success: true,
      response: agentResult.response,
      reply: agentResult.reply,
      order: agentResult.order,
      orderManifest: agentResult.orderManifest,
      razorpayOrder: agentResult.razorpayOrder,
      orderId: agentResult.orderId,
      keyId: getRazorpayKeyId()
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal agent error'
    });
  }
});

/**
 * POST /api/verify-payment
 * Cryptographically verifies Razorpay payment signature and updates order status to PAID
 */
apiRouter.post('/verify-payment', (req: Request, res: Response) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required.'
      });
    }

    const isValid = verifyPaymentSignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    // Locate order either by custom orderId or by razorpayOrderId
    let order = orderId ? getOrderById(orderId) : getOrderByRazorpayId(razorpayOrderId);

    if (!isValid) {
      if (order) {
        updateOrderStatus(order.id, 'FAILED', razorpayPaymentId);
      }
      return res.status(400).json({
        success: false,
        status: 'FAILED',
        error: 'Invalid payment signature. Cryptographic verification failed.'
      });
    }

    // Valid payment: transition status to PAID and decrement inventory
    if (order) {
      for (const item of order.items) {
        decrementStock(item.productId, item.quantity);
      }
      order = updateOrderStatus(order.id, 'PAID', razorpayPaymentId);
    }

    res.json({
      success: true,
      status: 'PAID',
      message: 'Payment verified successfully and stock updated.',
      order
    });
  } catch (error: any) {
    console.error('Error in /api/verify-payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/simulate-signature (Helper for Sandbox / Testing)
 */
apiRouter.post('/simulate-signature', (req: Request, res: Response) => {
  const { orderId, paymentId } = req.body;
  if (!orderId || !paymentId) {
    return res.status(400).json({ error: 'orderId and paymentId required' });
  }
  const signature = generateTestSignature(orderId, paymentId);
  res.json({ signature });
});
