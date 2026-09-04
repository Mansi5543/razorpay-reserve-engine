export type MandateStatus = 'ACTIVE' | 'EXHAUSTED' | 'REVOKED' | 'EXPIRED';

export interface SpendingMandate {
  id: string;
  userId: string;
  agentId: string;
  totalAuthorizedPaise: number;
  remainingPaise: number;
  currency: 'INR';
  validUntil: string;
  status: MandateStatus;
  mandateSecret: string; // Token bearer secret used by the autonomous agent
  signatureProof: string; // Cryptographic HMAC-SHA256 signature
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  mandateId: string;
  agentId: string;
  orderId: string;
  amountPaise: number;
  remainingPaise: number;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    pricePaise: number;
  }>;
  reason: string;
  signatureProof: string; // Cryptographic audit signature
  timestamp: string;
}

// In-Memory storage for mandates and audit logs
const mandatesMap = new Map<string, SpendingMandate>();
const auditLogsList: AuditLogEntry[] = [];

export function resetMandateStore(): void {
  mandatesMap.clear();
  auditLogsList.length = 0;
}

export function saveMandate(mandate: SpendingMandate): SpendingMandate {
  mandatesMap.set(mandate.id, { ...mandate });
  return { ...mandate };
}

export function getMandateById(id: string): SpendingMandate | undefined {
  const m = mandatesMap.get(id);
  return m ? { ...m } : undefined;
}

export function updateMandateRemaining(id: string, remainingPaise: number): SpendingMandate | undefined {
  const m = mandatesMap.get(id);
  if (!m) return undefined;
  m.remainingPaise = remainingPaise;
  if (remainingPaise <= 0) {
    m.status = 'EXHAUSTED';
  }
  return { ...m };
}

export function updateMandateStatus(id: string, status: MandateStatus): SpendingMandate | undefined {
  const m = mandatesMap.get(id);
  if (!m) return undefined;
  m.status = status;
  return { ...m };
}

export function appendAuditLog(entry: AuditLogEntry): AuditLogEntry {
  const copy = { ...entry };
  auditLogsList.unshift(copy); // latest first
  return copy;
}

export function getAuditLogs(mandateId?: string): AuditLogEntry[] {
  if (!mandateId) {
    return auditLogsList.map((a) => ({ ...a }));
  }
  return auditLogsList.filter((a) => a.mandateId === mandateId).map((a) => ({ ...a }));
}

export function getAllMandates(): SpendingMandate[] {
  return Array.from(mandatesMap.values()).map((m) => ({ ...m }));
}
