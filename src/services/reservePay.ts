import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  SpendingMandate,
  AuditLogEntry,
  saveMandate,
  getMandateById,
  updateMandateRemaining,
  updateMandateStatus,
  appendAuditLog,
  getAuditLogs
} from '../data/mandateStore.js';
import { calculateCartTotal } from './pricing.js';
import { saveOrder, decrementStock, Order } from '../data/store.js';

dotenv.config();

const MANDATE_MASTER_SECRET = process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret';

export class MandateLimitExceededError extends Error {
  public readonly totalPaise: number;
  public readonly remainingPaise: number;
  public readonly excessPaise: number;

  constructor(totalPaise: number, remainingPaise: number) {
    const excessPaise = totalPaise - remainingPaise;
    const totalINR = (totalPaise / 100).toFixed(2);
    const remainingINR = (remainingPaise / 100).toFixed(2);
    const excessINR = (excessPaise / 100).toFixed(2);
    super(
      `Mandate limit exceeded: Autonomous transaction of ₹${totalINR} (${totalPaise} paise) exceeds remaining authorized mandate balance of ₹${remainingINR} (${remainingPaise} paise) by ₹${excessINR} (${excessPaise} paise).`
    );
    this.name = 'MandateLimitExceededError';
    this.totalPaise = totalPaise;
    this.remainingPaise = remainingPaise;
    this.excessPaise = excessPaise;
  }
}

export class MandateInvalidError extends Error {
  constructor(message: string) {
    super(`Mandate Authorization Failed: ${message}`);
    this.name = 'MandateInvalidError';
  }
}

export interface CreateMandateParams {
  userId: string;
  agentId: string;
  maxBudgetPaise: number;
  validityHours?: number;
}

export interface DelegatedPaymentParams {
  mandateId: string;
  mandateSecret: string;
  agentId: string;
  items: Array<{ productId: string; quantity: number }>;
  reason?: string;
}

export interface DelegatedPaymentResult {
  success: boolean;
  order: Order;
  auditEntry: AuditLogEntry;
  remainingPaise: number;
}

/**
 * Creates and cryptographically signs a Pre-Authorized Budget Mandate (UPI Reserve Pay)
 */
export function createSpendingMandate(params: CreateMandateParams): SpendingMandate {
  const { userId, agentId, maxBudgetPaise, validityHours = 24 } = params;

  if (!userId || !agentId) {
    throw new Error('userId and agentId are required to create a mandate.');
  }

  if (!Number.isInteger(maxBudgetPaise) || maxBudgetPaise <= 0) {
    throw new Error('maxBudgetPaise must be a positive integer in paise.');
  }

  const mandateId = `mandate_${crypto.randomBytes(6).toString('hex')}`;
  const mandateSecret = `msec_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000).toISOString();

  // Cryptographic authorization proof
  const signaturePayload = `${mandateId}:${userId}:${agentId}:${maxBudgetPaise}:${validUntil}:${createdAt}`;
  const signatureProof = crypto
    .createHmac('sha256', MANDATE_MASTER_SECRET)
    .update(signaturePayload)
    .digest('hex');

  const mandate: SpendingMandate = {
    id: mandateId,
    userId,
    agentId,
    totalAuthorizedPaise: maxBudgetPaise,
    remainingPaise: maxBudgetPaise,
    currency: 'INR',
    validUntil,
    status: 'ACTIVE',
    mandateSecret,
    signatureProof,
    createdAt
  };

  saveMandate(mandate);
  return mandate;
}

/**
 * Executes an autonomous Agent-to-Agent Delegated Transaction
 * Enforces cryptographic validation, stock availability, and deterministic budget ceilings.
 */
export function executeDelegatedPayment(params: DelegatedPaymentParams): DelegatedPaymentResult {
  const { mandateId, mandateSecret, agentId, items, reason = 'Autonomous agent purchase' } = params;

  const mandate = getMandateById(mandateId);
  if (!mandate) {
    throw new MandateInvalidError(`Mandate '${mandateId}' not found.`);
  }

  if (mandate.status !== 'ACTIVE') {
    throw new MandateInvalidError(`Mandate is not active (current status: ${mandate.status}).`);
  }

  if (new Date() > new Date(mandate.validUntil)) {
    updateMandateStatus(mandate.id, 'EXPIRED');
    throw new MandateInvalidError('Mandate validity window has expired.');
  }

  if (mandate.agentId !== agentId) {
    throw new MandateInvalidError(`Agent '${agentId}' is not authorized for this mandate (authorized: '${mandate.agentId}').`);
  }

  // Constant-time comparison of mandate bearer secret
  const expectedSecretBuffer = Buffer.from(mandate.mandateSecret, 'utf8');
  const actualSecretBuffer = Buffer.from(mandateSecret, 'utf8');
  if (
    expectedSecretBuffer.length !== actualSecretBuffer.length ||
    !crypto.timingSafeEqual(expectedSecretBuffer, actualSecretBuffer)
  ) {
    throw new MandateInvalidError('Invalid mandate bearer secret token.');
  }

  // Deterministic cart price computation (LLM never computes monetary values)
  const calculation = calculateCartTotal(items);

  // Strict Financial Guardrail: Mandate Balance Constraint
  if (calculation.totalPaise > mandate.remainingPaise) {
    throw new MandateLimitExceededError(calculation.totalPaise, mandate.remainingPaise);
  }

  // Decrement remaining mandate balance
  const newRemainingPaise = mandate.remainingPaise - calculation.totalPaise;
  updateMandateRemaining(mandate.id, newRemainingPaise);

  // Decrement inventory stock
  for (const item of calculation.items) {
    decrementStock(item.productId, item.quantity);
  }

  // Create settled Order
  const orderId = `ord_auton_${crypto.randomBytes(6).toString('hex')}`;
  const order: Order = {
    id: orderId,
    items: calculation.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      pricePaise: i.pricePaise
    })),
    totalPaise: calculation.totalPaise,
    razorpayOrderId: `rzp_mandate_${mandate.id}`,
    status: 'PAID',
    createdAt: new Date().toISOString()
  };
  saveOrder(order);

  // Cryptographic Tamper-Evident Audit Proof
  const auditId = `audit_${crypto.randomBytes(6).toString('hex')}`;
  const auditTimestamp = new Date().toISOString();
  const auditPayload = `${auditId}:${mandate.id}:${agentId}:${order.id}:${calculation.totalPaise}:${newRemainingPaise}:${auditTimestamp}`;
  const auditSignature = crypto
    .createHmac('sha256', MANDATE_MASTER_SECRET)
    .update(auditPayload)
    .digest('hex');

  const auditEntry: AuditLogEntry = {
    id: auditId,
    mandateId: mandate.id,
    agentId,
    orderId: order.id,
    amountPaise: calculation.totalPaise,
    remainingPaise: newRemainingPaise,
    items: calculation.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      pricePaise: i.pricePaise
    })),
    reason,
    signatureProof: auditSignature,
    timestamp: auditTimestamp
  };

  appendAuditLog(auditEntry);

  return {
    success: true,
    order,
    auditEntry,
    remainingPaise: newRemainingPaise
  };
}

/**
 * Revokes an existing spending mandate immediately
 */
export function revokeSpendingMandate(mandateId: string): SpendingMandate {
  const mandate = getMandateById(mandateId);
  if (!mandate) {
    throw new MandateInvalidError(`Mandate '${mandateId}' not found.`);
  }

  const updated = updateMandateStatus(mandateId, 'REVOKED');
  return updated!;
}

export function getSpendingMandate(mandateId: string): SpendingMandate | undefined {
  return getMandateById(mandateId);
}

export function getMandateAuditTrail(mandateId?: string): AuditLogEntry[] {
  return getAuditLogs(mandateId);
}
