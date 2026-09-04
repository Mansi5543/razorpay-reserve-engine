let currentLedger = [];

document.addEventListener('DOMContentLoaded', () => {
  fetchMandateAndMetrics();
  fetchLedger();
  startClock();
});

function startClock() {
  const clockEl = document.getElementById('terminal-clock');
  setInterval(() => {
    if (clockEl) {
      clockEl.textContent = new Date().toLocaleTimeString();
    }
  }, 1000);
}

async function fetchMandateAndMetrics() {
  try {
    const res = await fetch('/api/mandates/active');
    const data = await res.json();
    if (data.success && data.mandate && data.metrics) {
      renderMetrics(data.mandate, data.metrics);
    }
  } catch (err) {
    console.warn('Error fetching mandate metrics:', err);
  }
}

function renderMetrics(mandate, metrics) {
  // Total Authorized
  const totalINR = (metrics.totalAuthorizedPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  document.getElementById('metric-total-authorized').textContent = `₹${totalINR}`;
  document.getElementById('metric-total-paise').textContent = `${metrics.totalAuthorizedPaise.toLocaleString('en-IN')} paise`;
  document.getElementById('mandate-id-pill').textContent = mandate.id;

  // Available Headroom
  const headroomINR = (metrics.availableHeadroomPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  document.getElementById('metric-available-headroom').textContent = `₹${headroomINR}`;
  document.getElementById('metric-headroom-paise').textContent = `${metrics.availableHeadroomPaise.toLocaleString('en-IN')} paise headroom`;

  // Utilization & Progress Bar
  const usedPct = metrics.utilizationPct;
  document.getElementById('metric-utilization-pct').textContent = `${usedPct}% Used`;
  const headroomPct = Math.max(0, Math.min(100, Math.round((metrics.availableHeadroomPaise / metrics.totalAuthorizedPaise) * 100)));
  const fillEl = document.getElementById('headroom-fill');
  fillEl.style.width = `${headroomPct}%`;

  if (headroomPct < 25) {
    fillEl.style.background = 'var(--accent-red)';
  } else if (headroomPct < 50) {
    fillEl.style.background = 'var(--accent-amber)';
  } else {
    fillEl.style.background = 'var(--accent-green)';
  }

  // Status Badge
  const statusBadge = document.getElementById('mandate-status-badge');
  statusBadge.textContent = mandate.status;
  if (mandate.status === 'ACTIVE') {
    statusBadge.className = 'status-active-badge';
  } else {
    statusBadge.className = 'badge-verdict blocked_headroom';
  }

  // Incidents Blocked
  document.getElementById('metric-incidents-blocked').textContent = metrics.securityIncidentsBlocked;
}

async function fetchLedger() {
  try {
    const res = await fetch('/api/ledger');
    const data = await res.json();

    if (data.success && data.ledger) {
      currentLedger = data.ledger;
      renderLedgerTable(data.ledger);
      if (data.metrics) {
        document.getElementById('metric-incidents-blocked').textContent = data.metrics.securityIncidentsBlocked;
      }
    }
  } catch (err) {
    console.warn('Error loading ledger:', err);
  }
}

function renderLedgerTable(entries) {
  const tbody = document.getElementById('ledger-tbody');
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-state">No ledger entries recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map((e) => {
    const timeFormatted = new Date(e.timestamp).toLocaleTimeString();
    const amountINR = `₹${(e.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const shortTxId = e.id.slice(0, 15) + '...';
    const shortHash = e.hmacSignature.slice(0, 10) + '...';

    let verdictClass = 'settled';
    if (e.verdict === 'BLOCKED_INSUFFICIENT_HEADROOM') verdictClass = 'blocked_headroom';
    if (e.verdict === 'BLOCKED_POLICY') verdictClass = 'blocked_policy';

    return `
      <tr onclick="openInspectorModal('${escapeHtml(e.id)}')">
        <td>${escapeHtml(timeFormatted)}</td>
        <td title="${escapeHtml(e.id)}"><code>${escapeHtml(shortTxId)}</code></td>
        <td style="color: #EDF2F7;">${escapeHtml(e.purpose || e.action)}</td>
        <td style="color: #7E8B9F;"><code>${escapeHtml(e.mcc)}</code></td>
        <td style="text-align: right; font-weight: 700; ${e.verdict === 'SETTLED' ? 'color: #34D399;' : 'color: #EF4444;'}">
          ${amountINR}
        </td>
        <td>
          <span class="badge-verdict ${verdictClass}">${escapeHtml(e.verdict)}</span>
        </td>
        <td>
          <span class="hash-cell" title="Click to verify HMAC signature proof">${escapeHtml(shortHash)}</span>
        </td>
      </tr>
    `;
  }).join('');
}

function setScenario(scenario) {
  const input = document.getElementById('mission-prompt');
  if (scenario === 'safe') {
    input.value = 'Spin up 1x H100 GPU compute node and provision vector DB index';
  } else if (scenario === 'overspend') {
    input.value = 'Lease 8x H100 Dedicated Datacenter Rack (₹8,000 lease breaches headroom)';
  } else if (scenario === 'unauthorized_mcc') {
    input.value = 'Deploy offshore digital casino wagering compute cluster (MCC 7995)';
  }
  handleDispatchMission();
}

async function handleDispatchMission() {
  const input = document.getElementById('mission-prompt');
  const prompt = input.value.trim();
  if (!prompt) return;

  const btn = document.getElementById('btn-dispatch');
  btn.disabled = true;
  btn.innerHTML = `<span>Executing...</span>`;

  appendTerminalLog('prompt', `[USER] Dispatching autonomous mission: "${prompt}"`);

  try {
    const res = await fetch('/api/agent/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<span>Dispatch Agent</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

    if (!data.success) {
      appendTerminalLog('critical', `[ERROR] Dispatch rejected by system: ${data.error || 'Unknown error'}`);
      return;
    }

    const { steps, summary } = data.taskResult;

    // Stream reasoning steps with progressive delay animation
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await delay(250);
      let logType = 'info';
      if (step.status === 'SUCCESS') logType = 'success';
      if (step.status === 'WARNING') logType = 'warning';
      if (step.status === 'CRITICAL') logType = 'critical';

      appendTerminalLog(logType, `[${step.phase}] ${step.action}: ${step.detail}`);
    }

    appendTerminalLog('prompt', `[OUTCOME] ${summary}`);

    // Update live metrics & ledger table
    if (data.mandate && data.metrics) {
      renderMetrics(data.mandate, data.metrics);
    }
    fetchLedger();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<span>Dispatch Agent</span>`;
    appendTerminalLog('critical', `[FATAL] Network error connecting to ReserveEngine API.`);
  }
}

async function handleResetMandate() {
  try {
    const res = await fetch('/api/mandates/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountPaise: 500000 })
    });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog('success', `[ADMIN] Payer mandate re-initialized with ₹5,000.00 (500,000 paise) reserve headroom.`);
      fetchMandateAndMetrics();
      fetchLedger();
    }
  } catch (err) {
    alert('Failed to reset mandate.');
  }
}

async function handleRevokeMandate() {
  if (!confirm('Are you sure you want to revoke this SBMD Mandate? The gatekeeper will block any further debits.')) {
    return;
  }

  try {
    const res = await fetch('/api/mandates/revoke', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog('critical', `[REVOCATION] Mandate ${data.mandate.id} manually revoked by payer. Status: REVOKED.`);
      fetchMandateAndMetrics();
      fetchLedger();
    }
  } catch (err) {
    alert('Failed to revoke mandate.');
  }
}

function appendTerminalLog(type, text) {
  const terminal = document.getElementById('terminal-stream');
  if (!terminal) return;

  const line = document.createElement('div');
  line.className = `term-line ${type}`;

  const ts = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="term-ts">[${ts}]</span> ${escapeHtml(text)}`;

  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function openInspectorModal(txId) {
  const entry = currentLedger.find((e) => e.id === txId);
  if (!entry) return;

  const modal = document.getElementById('inspector-modal');
  const body = document.getElementById('inspect-modal-body');
  document.getElementById('inspect-tx-id').textContent = entry.id;

  const rawPayload = `${entry.mandateId}:${entry.amountPaise}:${entry.timestamp}:${entry.idempotencyKey}:${entry.verdict}`;

  body.innerHTML = `
    <div class="inspector-grid">
      <div class="inspector-item">
        <div class="inspector-label">Mandate ID</div>
        <div class="inspector-val"><code>${escapeHtml(entry.mandateId)}</code></div>
      </div>
      <div class="inspector-item">
        <div class="inspector-label">Gate Verdict</div>
        <div class="inspector-val"><span class="badge-verdict ${entry.verdict.toLowerCase()}">${escapeHtml(entry.verdict)}</span></div>
      </div>
      <div class="inspector-item">
        <div class="inspector-label">Amount (Paise / INR)</div>
        <div class="inspector-val">₹${(entry.amountPaise / 100).toFixed(2)} (${entry.amountPaise} paise)</div>
      </div>
      <div class="inspector-item">
        <div class="inspector-label">Timestamp (ISO 8601)</div>
        <div class="inspector-val">${escapeHtml(entry.timestamp)}</div>
      </div>
      <div class="inspector-item">
        <div class="inspector-label">Target Merchant VPA</div>
        <div class="inspector-val"><code>${escapeHtml(entry.targetMerchantVpa)}</code></div>
      </div>
      <div class="inspector-item">
        <div class="inspector-label">Merchant Category (MCC)</div>
        <div class="inspector-val"><code>${escapeHtml(entry.mcc)}</code></div>
      </div>
    </div>

    <div class="inspector-full-item">
      <div class="inspector-label">Idempotency Key</div>
      <div class="code-box">${escapeHtml(entry.idempotencyKey)}</div>
    </div>

    <div class="inspector-full-item">
      <div class="inspector-label">HMAC-SHA256 Cryptographic Signature Proof</div>
      <div class="code-box" style="color: #10B981;">${escapeHtml(entry.hmacSignature)}</div>
    </div>

    <div class="inspector-full-item">
      <div class="inspector-label">Raw Canonical Payload Verified Over</div>
      <div class="code-box" style="color: #94A3B8;">${escapeHtml(rawPayload)}</div>
    </div>

    ${entry.razorpayPaymentId ? `
      <div class="inspector-full-item">
        <div class="inspector-label">Razorpay Settlement Reference</div>
        <div class="inspector-val"><code>${escapeHtml(entry.razorpayPaymentId)}</code></div>
      </div>
    ` : ''}

    ${entry.failureReason ? `
      <div class="inspector-full-item" style="border-color: rgba(239, 68, 68, 0.4);">
        <div class="inspector-label" style="color: #EF4444;">Gatekeeper Rejection Diagnostics</div>
        <div class="inspector-val" style="color: #FECACA;">${escapeHtml(entry.failureReason)}</div>
      </div>
    ` : ''}
  `;

  modal.classList.remove('hidden');
}

function closeInspectorModal() {
  const modal = document.getElementById('inspector-modal');
  if (modal) modal.classList.add('hidden');
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
