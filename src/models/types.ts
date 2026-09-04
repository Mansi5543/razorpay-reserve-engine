export type MandateStatus = 'ACTIVE' | 'REVOKED' | 'EXHAUSTED';

export interface MandateToken {
  id: string; // e.g. sbm_live_9f82c
  payerVpa: string; // e.g. enterprise.treasury@hdfcbank
  authorizedAgentId: string; // e.g. agent_devops_autonomous
  totalAuthorizedPaise: number; // max ₹10,000 / 1,000,000 paise per NPCI rules
  consumedPaise: number;
  availableHeadroomPaise: number;
  allowedMcc: string[]; // e.g. ["7372:Cloud Services", "8999:API Services", "7311:Ad Placement"]
  status: MandateStatus;
  expiresAt: string; // ISO 8601
  createdAt: string;
}

export type LedgerAction = 'RESERVE_HOLD' | 'DELEGATED_DEBIT' | 'POLICY_REJECT' | 'REVOCATION';
export type LedgerVerdict = 'SETTLED' | 'BLOCKED_POLICY' | 'BLOCKED_INSUFFICIENT_HEADROOM';

export interface LedgerEntry {
  id: string; // UUID
  timestamp: string; // ISO
  mandateId: string;
  action: LedgerAction;
  amountPaise: number;
  targetMerchantVpa: string;
  mcc: string;
  idempotencyKey: string;
  verdict: LedgerVerdict;
  failureReason?: string;
  razorpayPaymentId?: string;
  hmacSignature: string; // SHA256 hex string verifying record authenticity
  purpose?: string;
}

export interface AgentService {
  key: string;
  name: string;
  description: string;
  mcc: string; // e.g. 7372:Cloud Services
  merchantVpa: string;
  costPaise: number; // integer paise
  category: 'COMPUTE' | 'STORAGE' | 'NETWORK' | 'MARKETING' | 'RESTRICTED';
}

export interface DelegatedDebitRequest {
  mandateId: string;
  amountPaise: number;
  merchantVpa: string;
  mcc: string;
  taskIntent: string;
  idempotencyKey: string;
}

export interface DelegatedDebitResponse {
  success: boolean;
  verdict: LedgerVerdict;
  ledgerEntry: LedgerEntry;
  mandate: MandateToken;
}

export interface AgentReasoningStep {
  step: number;
  phase: 'DISCOVERY' | 'HEADROOM_CHECK' | 'GATEWAY_VALIDATION' | 'SETTLEMENT' | 'BLOCKED';
  action: string;
  detail: string;
  timestamp: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
}

export interface AgentTaskResult {
  missionPrompt: string;
  success: boolean;
  summary: string;
  steps: AgentReasoningStep[];
  settledDebits: LedgerEntry[];
  blockedDebits: LedgerEntry[];
}

export interface ConsoleMetrics {
  totalAuthorizedPaise: number;
  consumedPaise: number;
  availableHeadroomPaise: number;
  utilizationPct: number;
  securityIncidentsBlocked: number;
  totalTransactions: number;
}
