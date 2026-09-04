import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  SettlementGateway,
  InsufficientHeadroomError,
  PolicyViolationError,
  MandateInactiveError,
  DuplicateIdempotencyError
} from '../src/services/settlementGateway.js';

describe('Razorpay ReserveEngine: NPCI UPI SBMD Settlement Gateway', () => {
  let gateway: SettlementGateway;

  beforeEach(() => {
    gateway = new SettlementGateway();
    gateway.seedDefaultMandate(500000); // ₹5,000.00
  });

  it('accurately decrements available headroom in integer paise on valid debit', async () => {
    const initialMandate = gateway.getActiveMandate();
    expect(initialMandate.availableHeadroomPaise).toBe(500000);
    expect(initialMandate.consumedPaise).toBe(0);

    // Debit for GPU compute: ₹2,490.00 (249,000 paise)
    const res = await gateway.processDelegatedDebit({
      mandateId: initialMandate.id,
      amountPaise: 249000,
      merchantVpa: 'compute.infra@razorpay',
      mcc: '7372:Cloud Services',
      taskIntent: 'Provision 1x H100 GPU compute node',
      idempotencyKey: 'idemp_gpu_test_001'
    });

    expect(res.success).toBe(true);
    expect(res.verdict).toBe('SETTLED');
    expect(res.ledgerEntry.amountPaise).toBe(249000);
    expect(res.ledgerEntry.verdict).toBe('SETTLED');
    expect(res.ledgerEntry.razorpayPaymentId).toMatch(/^pay_/);

    const updatedMandate = gateway.getActiveMandate();
    expect(updatedMandate.consumedPaise).toBe(249000);
    expect(updatedMandate.availableHeadroomPaise).toBe(251000); // 500,000 - 249,000 = 251,000 paise
  });

  it('strictly throws InsufficientHeadroomError and logs BLOCKED_INSUFFICIENT_HEADROOM on overspend attempt', async () => {
    const mandate = gateway.getActiveMandate();
    // Attempting ₹8,000 (800,000 paise) against ₹5,000 headroom
    const debitPromise = gateway.processDelegatedDebit({
      mandateId: mandate.id,
      amountPaise: 800000,
      merchantVpa: 'superpod.datacenter@razorpay',
      mcc: '7372:Cloud Services',
      taskIntent: 'Lease 8x H100 dedicated rack cluster',
      idempotencyKey: 'idemp_overspend_test_002'
    });

    await expect(debitPromise).rejects.toThrowError(InsufficientHeadroomError);

    try {
      await gateway.processDelegatedDebit({
        mandateId: mandate.id,
        amountPaise: 800000,
        merchantVpa: 'superpod.datacenter@razorpay',
        mcc: '7372:Cloud Services',
        taskIntent: 'Lease 8x H100 dedicated rack cluster',
        idempotencyKey: 'idemp_overspend_test_003'
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(InsufficientHeadroomError);
      expect(err.amountPaise).toBe(800000);
      expect(err.availableHeadroomPaise).toBe(500000);
      expect(err.excessPaise).toBe(300000);
    }

    // Verify ledger contains the blocked record
    const ledger = gateway.getLedger();
    const blockedEntry = ledger.find((e) => e.idempotencyKey === 'idemp_overspend_test_002');
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry?.verdict).toBe('BLOCKED_INSUFFICIENT_HEADROOM');
    expect(blockedEntry?.action).toBe('POLICY_REJECT');

    // Headroom must remain completely unspent
    expect(gateway.getActiveMandate().availableHeadroomPaise).toBe(500000);
    expect(gateway.getActiveMandate().consumedPaise).toBe(0);
    expect(gateway.getMetrics().securityIncidentsBlocked).toBeGreaterThanOrEqual(1);
  });

  it('strictly throws PolicyViolationError and logs BLOCKED_POLICY for unauthorized MCC categories', async () => {
    const mandate = gateway.getActiveMandate();

    // MCC 7995 (Gambling & Betting) is not in allowedMcc
    const debitPromise = gateway.processDelegatedDebit({
      mandateId: mandate.id,
      amountPaise: 100000,
      merchantVpa: 'offshore.gaming@merchant',
      mcc: '7995:Gambling & Betting',
      taskIntent: 'Offshore gambling compute lease',
      idempotencyKey: 'idemp_mcc_test_004'
    });

    await expect(debitPromise).rejects.toThrowError(PolicyViolationError);

    // Verify ledger contains BLOCKED_POLICY
    const ledger = gateway.getLedger();
    const blockedEntry = ledger.find((e) => e.idempotencyKey === 'idemp_mcc_test_004');
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry?.verdict).toBe('BLOCKED_POLICY');
    expect(blockedEntry?.failureReason).toContain('7995');

    // Available funds must NOT be deducted
    expect(gateway.getActiveMandate().availableHeadroomPaise).toBe(500000);
  });

  it('enforces idempotency and rejects duplicated keys without double-debiting', async () => {
    const mandate = gateway.getActiveMandate();
    const idempotencyKey = 'idemp_unique_key_005';

    // First call succeeds
    const firstRes = await gateway.processDelegatedDebit({
      mandateId: mandate.id,
      amountPaise: 85000, // ₹850.00 DNS registrar
      merchantVpa: 'dns.registry@razorpay',
      mcc: '8999:API Services',
      taskIntent: 'Register DNS',
      idempotencyKey
    });
    expect(firstRes.success).toBe(true);
    expect(gateway.getActiveMandate().availableHeadroomPaise).toBe(415000);

    // Second call with IDENTICAL key must be rejected
    await expect(
      gateway.processDelegatedDebit({
        mandateId: mandate.id,
        amountPaise: 85000,
        merchantVpa: 'dns.registry@razorpay',
        mcc: '8999:API Services',
        taskIntent: 'Duplicate retry',
        idempotencyKey
      })
    ).rejects.toThrowError(DuplicateIdempotencyError);

    // Headroom must NOT be deducted a second time
    expect(gateway.getActiveMandate().availableHeadroomPaise).toBe(415000);
  });

  it('immediately blocks transactions after mandate is revoked', async () => {
    const mandate = gateway.getActiveMandate();
    gateway.revokeMandate(mandate.id);

    expect(gateway.getActiveMandate().status).toBe('REVOKED');

    await expect(
      gateway.processDelegatedDebit({
        mandateId: mandate.id,
        amountPaise: 100000,
        merchantVpa: 'compute.infra@razorpay',
        mcc: '7372:Cloud Services',
        taskIntent: 'Post-revocation attempt',
        idempotencyKey: 'idemp_post_revoke_006'
      })
    ).rejects.toThrowError(MandateInactiveError);
  });

  it('generates authentic cryptographic HMAC-SHA256 signatures on ledger entries', async () => {
    const mandate = gateway.getActiveMandate();
    const res = await gateway.processDelegatedDebit({
      mandateId: mandate.id,
      amountPaise: 125000,
      merchantVpa: 'vectordb.cloud@razorpay',
      mcc: '7372:Cloud Services',
      taskIntent: 'Vector DB provisioning',
      idempotencyKey: 'idemp_hmac_test_007'
    });

    const entry = res.ledgerEntry;
    expect(entry.hmacSignature).toHaveLength(64); // SHA-256 hex string

    // Recompute signature locally and verify exact match
    const secret = process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret';
    const payload = `${entry.mandateId}:${entry.amountPaise}:${entry.timestamp}:${entry.idempotencyKey}:${entry.verdict}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(entry.hmacSignature).toBe(expected);
  });
});
