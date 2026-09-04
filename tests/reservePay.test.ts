import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSpendingMandate,
  executeDelegatedPayment,
  revokeSpendingMandate,
  getSpendingMandate,
  getMandateAuditTrail,
  MandateLimitExceededError,
  MandateInvalidError
} from '../src/services/reservePay.js';
import { resetMandateStore } from '../src/data/mandateStore.js';
import { resetStore, getProductById } from '../src/data/store.js';

describe('UPI Reserve Pay & Delegated Spending Engine', () => {
  beforeEach(() => {
    resetStore();
    resetMandateStore();
  });

  it('creates and cryptographically pre-authorizes a spending mandate', () => {
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 500000, // ₹5,000
      validityHours: 12
    });

    expect(mandate.id).toMatch(/^mandate_/);
    expect(mandate.mandateSecret).toMatch(/^msec_/);
    expect(mandate.totalAuthorizedPaise).toBe(500000);
    expect(mandate.remainingPaise).toBe(500000);
    expect(mandate.status).toBe('ACTIVE');
    expect(mandate.signatureProof).toHaveLength(64); // SHA-256 hex string
    expect(new Date(mandate.validUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it('executes an autonomous purchase within the authorized mandate limit', () => {
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 500000 // ₹5,000
    });

    const initialStock = getProductById('prod_desk_pad')!.stock;

    // Autonomous agent purchases 1 Desk Pad (89,900 paise = ₹899)
    const result = executeDelegatedPayment({
      mandateId: mandate.id,
      mandateSecret: mandate.mandateSecret,
      agentId: 'agent_claude_buyer',
      items: [{ productId: 'prod_desk_pad', quantity: 1 }],
      reason: 'Agent automated workspace procurement'
    });

    expect(result.success).toBe(true);
    expect(result.order.status).toBe('PAID');
    expect(result.order.totalPaise).toBe(89900);
    expect(result.remainingPaise).toBe(410100); // 500,000 - 89,900 = 410,100 paise

    // Verify warehouse stock decreased
    const updatedStock = getProductById('prod_desk_pad')!.stock;
    expect(updatedStock).toBe(initialStock - 1);

    // Verify tamper-evident audit log was created
    expect(result.auditEntry).toBeDefined();
    expect(result.auditEntry.mandateId).toBe(mandate.id);
    expect(result.auditEntry.signatureProof).toHaveLength(64);
    expect(result.auditEntry.amountPaise).toBe(89900);
    expect(result.auditEntry.remainingPaise).toBe(410100);

    // Verify store mandate is updated
    const fetched = getSpendingMandate(mandate.id);
    expect(fetched?.remainingPaise).toBe(410100);
  });

  it('strictly throws MandateLimitExceededError when an agent attempts to spend more than remaining balance', () => {
    // Mandate authorized for only ₹1,000 (100,000 paise)
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 100000
    });

    // Ergonomic cushion costs ₹1,899 (189,900 paise)
    expect(() => {
      executeDelegatedPayment({
        mandateId: mandate.id,
        mandateSecret: mandate.mandateSecret,
        agentId: 'agent_claude_buyer',
        items: [{ productId: 'prod_ergo_cushion', quantity: 1 }]
      });
    }).toThrowError(MandateLimitExceededError);

    try {
      executeDelegatedPayment({
        mandateId: mandate.id,
        mandateSecret: mandate.mandateSecret,
        agentId: 'agent_claude_buyer',
        items: [{ productId: 'prod_ergo_cushion', quantity: 1 }]
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(MandateLimitExceededError);
      expect(err.totalPaise).toBe(189900);
      expect(err.remainingPaise).toBe(100000);
      expect(err.excessPaise).toBe(89900);
    }

    // Ensure mandate balance was not depleted
    expect(getSpendingMandate(mandate.id)?.remainingPaise).toBe(100000);
  });

  it('rejects unauthorized agents and invalid bearer secret tokens', () => {
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 200000
    });

    // Wrong agent ID
    expect(() => {
      executeDelegatedPayment({
        mandateId: mandate.id,
        mandateSecret: mandate.mandateSecret,
        agentId: 'rogue_ai_agent',
        items: [{ productId: 'prod_desk_pad', quantity: 1 }]
      });
    }).toThrowError(MandateInvalidError);

    // Wrong secret token
    expect(() => {
      executeDelegatedPayment({
        mandateId: mandate.id,
        mandateSecret: 'msec_invalid_token_xyz',
        agentId: 'agent_claude_buyer',
        items: [{ productId: 'prod_desk_pad', quantity: 1 }]
      });
    }).toThrowError(MandateInvalidError);
  });

  it('immediately blocks transactions after mandate is revoked', () => {
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 500000
    });

    const revoked = revokeSpendingMandate(mandate.id);
    expect(revoked.status).toBe('REVOKED');

    expect(() => {
      executeDelegatedPayment({
        mandateId: mandate.id,
        mandateSecret: mandate.mandateSecret,
        agentId: 'agent_claude_buyer',
        items: [{ productId: 'prod_desk_pad', quantity: 1 }]
      });
    }).toThrowError(/not active/);
  });

  it('tracks sequential autonomous charges and maintains an immutable audit trail', () => {
    const mandate = createSpendingMandate({
      userId: 'user_alex_test',
      agentId: 'agent_claude_buyer',
      maxBudgetPaise: 300000 // ₹3,000
    });

    // Transaction 1: Desk pad (89,900 paise)
    executeDelegatedPayment({
      mandateId: mandate.id,
      mandateSecret: mandate.mandateSecret,
      agentId: 'agent_claude_buyer',
      items: [{ productId: 'prod_desk_pad', quantity: 1 }]
    });

    // Transaction 2: Another Desk pad (89,900 paise)
    executeDelegatedPayment({
      mandateId: mandate.id,
      mandateSecret: mandate.mandateSecret,
      agentId: 'agent_claude_buyer',
      items: [{ productId: 'prod_desk_pad', quantity: 1 }]
    });

    const auditLogs = getMandateAuditTrail(mandate.id);
    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[0].remainingPaise).toBe(120200); // 300,000 - 89,900 - 89,900 = 120,200 paise
    expect(auditLogs[1].remainingPaise).toBe(210100);
  });
});
