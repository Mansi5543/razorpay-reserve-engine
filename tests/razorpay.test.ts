import { describe, it, expect } from 'vitest';
import {
  verifyPaymentSignature,
  generateTestSignature,
  createRazorpayOrder
} from '../src/services/razorpay.js';

describe('Razorpay Cryptographic Signature & Order Service', () => {
  const sampleOrderId = 'order_DA2910fa8bc91234';
  const samplePaymentId = 'pay_9876543210fedcba';

  it('verifies a genuine HMAC-SHA256 signature using positional parameters', () => {
    const validSignature = generateTestSignature(sampleOrderId, samplePaymentId);

    const isValid = verifyPaymentSignature(sampleOrderId, samplePaymentId, validSignature);
    expect(isValid).toBe(true);
  });

  it('verifies a genuine HMAC-SHA256 signature using object parameters', () => {
    const validSignature = generateTestSignature(sampleOrderId, samplePaymentId);

    const isValid = verifyPaymentSignature({
      razorpayOrderId: sampleOrderId,
      razorpayPaymentId: samplePaymentId,
      razorpaySignature: validSignature
    });

    expect(isValid).toBe(true);
  });

  it('rejects a tampered signature string', () => {
    const fakeSignature = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const isValid = verifyPaymentSignature(sampleOrderId, samplePaymentId, fakeSignature);
    expect(isValid).toBe(false);
  });

  it('rejects when order ID or payment ID is swapped or altered', () => {
    const validSignature = generateTestSignature(sampleOrderId, samplePaymentId);

    // Altered payment ID
    const isValid = verifyPaymentSignature(sampleOrderId, 'pay_tampered_id', validSignature);
    expect(isValid).toBe(false);
  });

  it('safely rejects empty or malformed parameters without unhandled exception', () => {
    expect(verifyPaymentSignature('', samplePaymentId, 'sig')).toBe(false);
    expect(verifyPaymentSignature(sampleOrderId, '', 'sig')).toBe(false);
    expect(verifyPaymentSignature(sampleOrderId, samplePaymentId, '')).toBe(false);
  });

  it('generates a valid order payload with integer paise amounts (positional)', async () => {
    const orderResult = await createRazorpayOrder(249900, 'rcpt_test_pos_001');

    expect(orderResult).toBeDefined();
    expect(orderResult.id).toMatch(/^order_/);
    expect(orderResult.amount).toBe(249900);
    expect(orderResult.currency).toBe('INR');
  });

  it('generates a valid order payload with integer paise amounts (options object)', async () => {
    const orderResult = await createRazorpayOrder({
      amountPaise: 249900,
      receiptId: 'rcpt_test_obj_002',
      notes: { test: 'true' }
    });

    expect(orderResult).toBeDefined();
    expect(orderResult.id).toMatch(/^order_/);
    expect(orderResult.amount).toBe(249900);
    expect(orderResult.currency).toBe('INR');
  });
});
