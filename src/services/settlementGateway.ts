import crypto from 'crypto';
import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import {
  MandateToken,
  LedgerEntry,
  AgentService,
  DelegatedDebitRequest,
  DelegatedDebitResponse,
  ConsoleMetrics
} from '../models/types.js';

dotenv.config();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret';

let razorpayClient: Razorpay | null = null;
try {
  if (RAZORPAY_KEY_ID && !RAZORPAY_KEY_ID.includes('placeholder') && !RAZORPAY_KEY_ID.includes('your_')) {
    razorpayClient = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
  }
} catch (err) {
  console.warn('[SettlementGateway] Razorpay client init warning:', err);
}

// Custom Fintech Domain Exceptions
export class InsufficientHeadroomError extends Error {
  public readonly amountPaise: number;
  public readonly availableHeadroomPaise: number;
  public readonly excessPaise: number;

  constructor(amountPaise: number, availableHeadroomPaise: number) {
    const excessPaise = amountPaise - availableHeadroomPaise;
    const amountINR = (amountPaise / 100).toFixed(2);
    const headroomINR = (availableHeadroomPaise / 100).toFixed(2);
    const excessINR = (excessPaise / 100).toFixed(2);
    super(
      `Insufficient Headroom: Debit of ₹${amountINR} (${amountPaise} paise) exceeds available reserve headroom of ₹${headroomINR} (${availableHeadroomPaise} paise) by ₹${excessINR} (${excessPaise} paise).`
    );
    this.name = 'InsufficientHeadroomError';
    this.amountPaise = amountPaise;
    this.availableHeadroomPaise = availableHeadroomPaise;
    this.excessPaise = excessPaise;
  }
}

export class PolicyViolationError extends Error {
  public readonly requestedMcc: string;
  public readonly allowedMcc: string[];

  constructor(requestedMcc: string, allowedMcc: string[]) {
    super(
      `Policy Violation: Merchant Category Code '${requestedMcc}' is not permitted by payer mandate. Allowed MCC categories: [${allowedMcc.join(', ')}].`
    );
    this.name = 'PolicyViolationError';
    this.requestedMcc = requestedMcc;
    this.allowedMcc = allowedMcc;
  }
}

export class MandateInactiveError extends Error {
  constructor(status: string) {
    super(`Mandate Inactive: Transaction blocked because mandate status is '${status}'.`);
    this.name = 'MandateInactiveError';
  }
}

export class DuplicateIdempotencyError extends Error {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`Idempotency Violation: Duplicate request with idempotency key '${idempotencyKey}' was already processed.`);
    this.name = 'DuplicateIdempotencyError';
    this.idempotencyKey = idempotencyKey;
  }
}

// Authorized Enterprise Cloud & Developer Services Catalog
export const ENTERPRISE_SERVICES: AgentService[] = [
  {
    key: 'srv_gpu_h100',
    name: 'H100 Tensor Core GPU Compute Node',
    description: '1x NVIDIA H100 80GB SXM5 instance for LLM fine-tuning and inference serving (1-hour lease).',
    mcc: '7372:Cloud Services',
    merchantVpa: 'compute.infra@razorpay',
    costPaise: 249000, // ₹2,490.00
    category: 'COMPUTE'
  },
  {
    key: 'srv_vector_db',
    name: 'Dedicated Vector Indexing Tier (10M Vectors)',
    description: 'High-throughput Qdrant / Pinecone cluster slice with real-time semantic search indexing.',
    mcc: '7372:Cloud Services',
    merchantVpa: 'vectordb.cloud@razorpay',
    costPaise: 125000, // ₹1,250.00
    category: 'STORAGE'
  },
  {
    key: 'srv_dns_registrar',
    name: 'Automated TLS & Anycast DNS Registrar',
    description: 'Automated domain lease reservation and DNS record propagation for deployed agent endpoints.',
    mcc: '8999:API Services',
    merchantVpa: 'dns.registry@razorpay',
    costPaise: 85000, // ₹850.00
    category: 'NETWORK'
  },
  {
    key: 'srv_ad_placement',
    name: 'Real-Time Bidstream Ad Placement Package',
    description: 'Programmatic targeted publisher network ad impressions credit bundle.',
    mcc: '7311:Ad Placement',
    merchantVpa: 'adops.exchange@razorpay',
    costPaise: 320000, // ₹3,200.00
    category: 'MARKETING'
  },
  {
    key: 'srv_casino_compute',
    name: 'High-Rollers Wagering Compute Cluster',
    description: 'Offshore high-frequency digital casino and gambling compute infrastructure.',
    mcc: '7995:Gambling & Betting',
    merchantVpa: 'offshore.gaming@merchant',
    costPaise: 450000, // ₹4,500.00
    category: 'RESTRICTED'
  },
  {
    key: 'srv_rack_cluster',
    name: '8x H100 Dedicated Datacenter Rack (24h Lease)',
    description: 'Multi-GPU DGX SuperPOD node allocation for massive model distributed pre-training.',
    mcc: '7372:Cloud Services',
    merchantVpa: 'superpod.datacenter@razorpay',
    costPaise: 800000, // ₹8,000.00 (Exceeds ₹5,000 Headroom)
    category: 'COMPUTE'
  }
];

export class SettlementGateway {
  private activeMandate: MandateToken;
  private ledger: LedgerEntry[] = [];
  private idempotencyCache: Map<string, LedgerEntry> = new Map();
  private securityIncidentsBlocked: number = 0;

  constructor() {
    this.activeMandate = this.seedDefaultMandate();
  }

  public seedDefaultMandate(totalAuthorizedPaise: number = 500000): MandateToken {
    const totalPaise = Math.min(1000000, Math.max(100000, Math.round(totalAuthorizedPaise)));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const mandate: MandateToken = {
      id: 'sbm_live_9f82c',
      payerVpa: 'enterprise.treasury@hdfcbank',
      authorizedAgentId: 'agent_devops_autonomous',
      totalAuthorizedPaise: totalPaise,
      consumedPaise: 0,
      availableHeadroomPaise: totalPaise,
      allowedMcc: ['7372:Cloud Services', '8999:API Services', '7311:Ad Placement'],
      status: 'ACTIVE',
      expiresAt,
      createdAt: now.toISOString()
    };

    // Initial Ledger Entry: Reserve Hold
    const holdEntry = this.createLedgerEntry({
      mandateId: mandate.id,
      action: 'RESERVE_HOLD',
      amountPaise: totalPaise,
      targetMerchantVpa: 'npci.sbm.settlement@rbi',
      mcc: '6012:Financial Institutions',
      idempotencyKey: `init_hold_${mandate.id}`,
      verdict: 'SETTLED',
      purpose: 'NPCI UPI SBMD Initial Pre-Authorization Hold'
    });

    this.activeMandate = mandate;
    this.ledger = [holdEntry];
    this.idempotencyCache.clear();
    this.idempotencyCache.set(holdEntry.idempotencyKey, holdEntry);
    this.securityIncidentsBlocked = 0;

    return { ...mandate };
  }

  public getActiveMandate(): MandateToken {
    return { ...this.activeMandate };
  }

  public getLedger(): LedgerEntry[] {
    return this.ledger.map((entry) => ({ ...entry }));
  }

  public getServices(): AgentService[] {
    return ENTERPRISE_SERVICES.map((s) => ({ ...s }));
  }

  public getMetrics(): ConsoleMetrics {
    const total = this.activeMandate.totalAuthorizedPaise;
    const consumed = this.activeMandate.consumedPaise;
    const utilizationPct = total > 0 ? Math.round((consumed / total) * 100) : 0;

    return {
      totalAuthorizedPaise: total,
      consumedPaise: consumed,
      availableHeadroomPaise: this.activeMandate.availableHeadroomPaise,
      utilizationPct,
      securityIncidentsBlocked: this.securityIncidentsBlocked,
      totalTransactions: this.ledger.length
    };
  }

  public revokeMandate(mandateId: string): MandateToken {
    if (this.activeMandate.id !== mandateId) {
      throw new Error(`Mandate '${mandateId}' not found.`);
    }

    this.activeMandate.status = 'REVOKED';

    const revokeEntry = this.createLedgerEntry({
      mandateId: this.activeMandate.id,
      action: 'REVOCATION',
      amountPaise: this.activeMandate.availableHeadroomPaise,
      targetMerchantVpa: 'npci.sbm.settlement@rbi',
      mcc: '6012:Financial Institutions',
      idempotencyKey: `revoke_${Date.now()}`,
      verdict: 'SETTLED',
      purpose: 'Manual user revocation of active SBMD mandate'
    });

    this.ledger.unshift(revokeEntry);
    return { ...this.activeMandate };
  }

  /**
   * Cryptographically generates a tamper-evident HMAC-SHA256 signature for ledger entries
   */
  public generateHmacSignature(payload: string): string {
    return crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');
  }

  private createLedgerEntry(params: {
    mandateId: string;
    action: LedgerEntry['action'];
    amountPaise: number;
    targetMerchantVpa: string;
    mcc: string;
    idempotencyKey: string;
    verdict: LedgerEntry['verdict'];
    failureReason?: string;
    razorpayPaymentId?: string;
    purpose?: string;
  }): LedgerEntry {
    const id = `tx_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const rawPayload = `${params.mandateId}:${params.amountPaise}:${timestamp}:${params.idempotencyKey}:${params.verdict}`;
    const hmacSignature = this.generateHmacSignature(rawPayload);

    return {
      id,
      timestamp,
      mandateId: params.mandateId,
      action: params.action,
      amountPaise: params.amountPaise,
      targetMerchantVpa: params.targetMerchantVpa,
      mcc: params.mcc,
      idempotencyKey: params.idempotencyKey,
      verdict: params.verdict,
      failureReason: params.failureReason,
      razorpayPaymentId: params.razorpayPaymentId,
      hmacSignature,
      purpose: params.purpose
    };
  }

  /**
   * Core NPCI UPI SBMD Delegated Debit Execution Gatekeeper
   */
  public async processDelegatedDebit(request: DelegatedDebitRequest): Promise<DelegatedDebitResponse> {
    const { mandateId, amountPaise, merchantVpa, mcc, taskIntent, idempotencyKey } = request;

    // 1. Idempotency Check: prevent duplicate debits
    if (this.idempotencyCache.has(idempotencyKey)) {
      throw new DuplicateIdempotencyError(idempotencyKey);
    }

    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error(`Invalid amount: must be positive integer paise (received ${amountPaise}).`);
    }

    // 2. Mandate State Check
    if (this.activeMandate.id !== mandateId) {
      throw new Error(`Mandate '${mandateId}' does not exist.`);
    }

    if (this.activeMandate.status !== 'ACTIVE') {
      const rejectEntry = this.createLedgerEntry({
        mandateId,
        action: 'POLICY_REJECT',
        amountPaise,
        targetMerchantVpa: merchantVpa,
        mcc,
        idempotencyKey,
        verdict: 'BLOCKED_POLICY',
        failureReason: `Mandate is in '${this.activeMandate.status}' state`,
        purpose: taskIntent
      });
      this.ledger.unshift(rejectEntry);
      this.idempotencyCache.set(idempotencyKey, rejectEntry);
      this.securityIncidentsBlocked++;
      throw new MandateInactiveError(this.activeMandate.status);
    }

    if (new Date() > new Date(this.activeMandate.expiresAt)) {
      this.activeMandate.status = 'EXHAUSTED';
      const rejectEntry = this.createLedgerEntry({
        mandateId,
        action: 'POLICY_REJECT',
        amountPaise,
        targetMerchantVpa: merchantVpa,
        mcc,
        idempotencyKey,
        verdict: 'BLOCKED_POLICY',
        failureReason: 'Mandate validity period expired',
        purpose: taskIntent
      });
      this.ledger.unshift(rejectEntry);
      this.idempotencyCache.set(idempotencyKey, rejectEntry);
      this.securityIncidentsBlocked++;
      throw new MandateInactiveError('EXPIRED');
    }

    // 3. Merchant Category Code (MCC) Enforcement
    const isMccAllowed = this.activeMandate.allowedMcc.some((allowed) => {
      const allowedPrefix = allowed.split(':')[0].trim();
      const requestedPrefix = mcc.split(':')[0].trim();
      return allowedPrefix === requestedPrefix || allowed.toLowerCase() === mcc.toLowerCase();
    });

    if (!isMccAllowed) {
      this.securityIncidentsBlocked++;
      const rejectEntry = this.createLedgerEntry({
        mandateId,
        action: 'POLICY_REJECT',
        amountPaise,
        targetMerchantVpa: merchantVpa,
        mcc,
        idempotencyKey,
        verdict: 'BLOCKED_POLICY',
        failureReason: `MCC '${mcc}' not permitted in payer mandate policy`,
        purpose: taskIntent
      });
      this.ledger.unshift(rejectEntry);
      this.idempotencyCache.set(idempotencyKey, rejectEntry);
      throw new PolicyViolationError(mcc, this.activeMandate.allowedMcc);
    }

    // 4. Headroom Check: Exact integer paise arithmetic
    if (this.activeMandate.consumedPaise + amountPaise > this.activeMandate.totalAuthorizedPaise) {
      this.securityIncidentsBlocked++;
      const rejectEntry = this.createLedgerEntry({
        mandateId,
        action: 'POLICY_REJECT',
        amountPaise,
        targetMerchantVpa: merchantVpa,
        mcc,
        idempotencyKey,
        verdict: 'BLOCKED_INSUFFICIENT_HEADROOM',
        failureReason: `Debit of ₹${(amountPaise / 100).toFixed(2)} exceeds available headroom of ₹${(this.activeMandate.availableHeadroomPaise / 100).toFixed(2)}`,
        purpose: taskIntent
      });
      this.ledger.unshift(rejectEntry);
      this.idempotencyCache.set(idempotencyKey, rejectEntry);
      throw new InsufficientHeadroomError(amountPaise, this.activeMandate.availableHeadroomPaise);
    }

    // 5. Razorpay Settlement Integration
    let razorpayPaymentId: string;
    if (razorpayClient) {
      try {
        const order = await razorpayClient.orders.create({
          amount: amountPaise,
          currency: 'INR',
          receipt: `rcpt_${idempotencyKey.slice(0, 30)}`,
          notes: { mandateId, merchantVpa, mcc, taskIntent }
        });
        razorpayPaymentId = `pay_${order.id.replace('order_', '')}`;
      } catch (err) {
        razorpayPaymentId = `pay_mock_${crypto.randomBytes(6).toString('hex')}`;
      }
    } else {
      razorpayPaymentId = `pay_sbm_${crypto.randomBytes(6).toString('hex')}`;
    }

    // 6. Atomic State Mutation: Deduct Headroom & Increment Consumed
    this.activeMandate.consumedPaise += amountPaise;
    this.activeMandate.availableHeadroomPaise -= amountPaise;

    if (this.activeMandate.availableHeadroomPaise === 0) {
      this.activeMandate.status = 'EXHAUSTED';
    }

    // 7. Write Settled Ledger Entry
    const settledEntry = this.createLedgerEntry({
      mandateId,
      action: 'DELEGATED_DEBIT',
      amountPaise,
      targetMerchantVpa: merchantVpa,
      mcc,
      idempotencyKey,
      verdict: 'SETTLED',
      razorpayPaymentId,
      purpose: taskIntent
    });

    this.ledger.unshift(settledEntry);
    this.idempotencyCache.set(idempotencyKey, settledEntry);

    return {
      success: true,
      verdict: 'SETTLED',
      ledgerEntry: settledEntry,
      mandate: { ...this.activeMandate }
    };
  }
}

export const settlementGateway = new SettlementGateway();
