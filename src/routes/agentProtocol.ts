import { Router, Request, Response } from 'express';
import { getProducts } from '../data/store.js';
import { getAllMandates } from '../data/mandateStore.js';
import {
  createSpendingMandate,
  executeDelegatedPayment,
  revokeSpendingMandate,
  getSpendingMandate,
  getMandateAuditTrail,
  MandateLimitExceededError,
  MandateInvalidError
} from '../services/reservePay.js';

export const agentProtocolRouter = Router();

/**
 * Standardized Agent Discovery Manifest
 * Open-standard discovery endpoint for external autonomous agents (Claude, OpenAI, autonomous buyers)
 */
export function getAgentDiscoveryManifest(baseUrl: string = 'http://localhost:3000') {
  return {
    protocol_version: '2026.1-agentic-commerce',
    specification: 'UPI Reserve Pay & Agent-Readable Commerce Specification',
    vendor: 'Apex Commerce Engine',
    capabilities: [
      'machine_readable_catalog',
      'deterministic_financial_guardrails',
      'tokenized_delegated_mandates',
      'autonomous_agent_settlement',
      'cryptographic_audit_trail'
    ],
    currency: {
      code: 'INR',
      smallest_unit: 'paise',
      factor: 100,
      description: '1 INR = 100 paise. All financial operations strictly computed in integer paise.'
    },
    payment_methods_supported: [
      {
        id: 'UPI_RESERVE_PAY',
        description: 'Tokenized Pre-Authorized Reserve Mandate with cryptographic balance lock.'
      },
      {
        id: 'RAZORPAY_CHECKOUT',
        description: 'Interactive card/UPI checkout modal via Razorpay Checkout.js.'
      }
    ],
    endpoints: {
      discovery: `${baseUrl}/.well-known/agent-catalog.json`,
      catalog: `${baseUrl}/api/agent/catalog`,
      create_mandate: `${baseUrl}/api/mandates/create`,
      charge_mandate: `${baseUrl}/api/mandates/charge`,
      mandate_status: `${baseUrl}/api/mandates/:id`,
      revoke_mandate: `${baseUrl}/api/mandates/:id/revoke`,
      audit_trail: `${baseUrl}/api/mandates/:id/audit`
    }
  };
}

/**
 * Open Standard Manifest Route
 */
agentProtocolRouter.get('/.well-known/agent-catalog.json', (req: Request, res: Response) => {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  res.json(getAgentDiscoveryManifest(`${protocol}://${host}`));
});

/**
 * GET /api/agent/catalog
 * Standardized machine-readable catalog with semantic metadata for AI agent discovery
 */
agentProtocolRouter.get('/api/agent/catalog', (_req: Request, res: Response) => {
  try {
    const products = getProducts();
    res.json({
      success: true,
      standard: 'agentic-commerce/1.0',
      total_items: products.length,
      currency: 'INR',
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        price_paise: p.pricePaise,
        price_inr: `₹${(p.pricePaise / 100).toFixed(2)}`,
        in_stock: p.stock > 0,
        stock_units: p.stock
      }))
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mandates/create
 * Issue a Pre-Authorized Budget Mandate (UPI Reserve Pay)
 */
agentProtocolRouter.post('/api/mandates/create', (req: Request, res: Response) => {
  try {
    const { userId, agentId, maxBudgetPaise, maxBudgetINR, validityHours } = req.body;

    let budgetPaise = maxBudgetPaise;
    if (typeof maxBudgetINR === 'number' && maxBudgetINR > 0) {
      budgetPaise = Math.round(maxBudgetINR * 100);
    }

    if (!budgetPaise || budgetPaise <= 0) {
      return res.status(400).json({
        success: false,
        error: 'maxBudgetPaise or maxBudgetINR must be provided as a positive value.'
      });
    }

    const mandate = createSpendingMandate({
      userId: userId || 'user_demo_shopper',
      agentId: agentId || 'agent_claude_buyer_01',
      maxBudgetPaise: budgetPaise,
      validityHours: validityHours ? parseInt(validityHours, 10) : 24
    });

    res.json({
      success: true,
      message: 'Spending mandate pre-authorized successfully.',
      mandate
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mandates/charge
 * Autonomous Agent executes purchase directly against a pre-authorized mandate token
 */
agentProtocolRouter.post('/api/mandates/charge', (req: Request, res: Response) => {
  try {
    const { mandateId, mandateSecret, agentId, items, reason } = req.body;

    if (!mandateId || !mandateSecret || !agentId || !items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: mandateId, mandateSecret, agentId, and items array are all required.'
      });
    }

    const result = executeDelegatedPayment({
      mandateId,
      mandateSecret,
      agentId,
      items,
      reason: reason || 'Autonomous AI purchase'
    });

    res.json({
      success: true,
      message: 'Autonomous delegated purchase executed and cryptographically verified.',
      order: result.order,
      auditEntry: result.auditEntry,
      remainingPaise: result.remainingPaise,
      remainingINR: `₹${(result.remainingPaise / 100).toFixed(2)}`
    });
  } catch (err: any) {
    if (err instanceof MandateLimitExceededError) {
      return res.status(422).json({
        success: false,
        errorType: 'MANDATE_LIMIT_EXCEEDED',
        error: err.message,
        totalPaise: err.totalPaise,
        remainingPaise: err.remainingPaise,
        excessPaise: err.excessPaise
      });
    }

    if (err instanceof MandateInvalidError) {
      return res.status(401).json({
        success: false,
        errorType: 'MANDATE_INVALID',
        error: err.message
      });
    }

    res.status(400).json({
      success: false,
      errorType: 'TRANSACTION_FAILED',
      error: err.message || 'Payment execution failed'
    });
  }
});

/**
 * GET /api/mandates
 * List all mandates
 */
agentProtocolRouter.get('/api/mandates', (_req: Request, res: Response) => {
  res.json({
    success: true,
    mandates: getAllMandates()
  });
});

/**
 * GET /api/mandates/:id
 * Retrieve a specific mandate's state and remaining balance
 */
agentProtocolRouter.get('/api/mandates/:id', (req: Request, res: Response) => {
  const mandate = getSpendingMandate(req.params.id);
  if (!mandate) {
    return res.status(404).json({ success: false, error: 'Mandate not found.' });
  }
  res.json({ success: true, mandate });
});

/**
 * POST /api/mandates/:id/revoke
 * Instantly revoke a spending mandate
 */
agentProtocolRouter.post('/api/mandates/:id/revoke', (req: Request, res: Response) => {
  try {
    const updated = revokeSpendingMandate(req.params.id);
    res.json({
      success: true,
      message: 'Mandate revoked successfully. No further autonomous charges will be authorized.',
      mandate: updated
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mandates/:id/audit
 * Retrieve the tamper-evident cryptographic audit trail for a mandate
 */
agentProtocolRouter.get('/api/mandates/:id/audit', (req: Request, res: Response) => {
  const auditLogs = getMandateAuditTrail(req.params.id);
  res.json({
    success: true,
    mandateId: req.params.id,
    count: auditLogs.length,
    auditTrail: auditLogs
  });
});

/**
 * GET /api/audit-trail
 * Global audit log feed
 */
agentProtocolRouter.get('/api/audit-trail', (_req: Request, res: Response) => {
  const allLogs = getMandateAuditTrail();
  res.json({
    success: true,
    count: allLogs.length,
    auditTrail: allLogs
  });
});
