import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { settlementGateway } from './services/settlementGateway.js';
import { executeAgentTask } from './agent/agentTools.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Enterprise Middlewares
app.use(cors());
app.use(express.json());

// -----------------------------------------------------------
// NPCI UPI SBMD REST Controller Endpoints
// -----------------------------------------------------------

/**
 * GET /api/mandates/active
 * Returns live active mandate state, spent percentage, and available headroom
 */
app.get('/api/mandates/active', (_req: Request, res: Response) => {
  try {
    const mandate = settlementGateway.getActiveMandate();
    const metrics = settlementGateway.getMetrics();
    res.json({
      success: true,
      standard: 'NPCI-UPI-SBMD/v1.4',
      mandate,
      metrics
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/ledger
 * Returns full chronological audit trail with cryptographic HMAC-SHA256 proofs
 */
app.get('/api/ledger', (_req: Request, res: Response) => {
  try {
    const ledger = settlementGateway.getLedger();
    const metrics = settlementGateway.getMetrics();
    res.json({
      success: true,
      count: ledger.length,
      metrics,
      ledger
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/services
 * Returns available developer & AI cloud services catalog
 */
app.get('/api/services', (_req: Request, res: Response) => {
  try {
    const services = settlementGateway.getServices();
    res.json({
      success: true,
      count: services.length,
      services
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent/dispatch
 * Accepts { prompt: string }, runs the autonomous agent loop, and returns execution trace
 */
app.post('/api/agent/dispatch', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required string parameter "prompt".'
      });
    }

    const taskResult = await executeAgentTask(prompt);
    const updatedMetrics = settlementGateway.getMetrics();
    const updatedMandate = settlementGateway.getActiveMandate();

    res.json({
      success: true,
      taskResult,
      metrics: updatedMetrics,
      mandate: updatedMandate
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mandates/revoke
 * Manually revokes active mandate
 */
app.post('/api/mandates/revoke', (req: Request, res: Response) => {
  try {
    const { mandateId } = req.body;
    const active = settlementGateway.getActiveMandate();
    const idToRevoke = mandateId || active.id;
    const revoked = settlementGateway.revokeMandate(idToRevoke);

    res.json({
      success: true,
      message: `Mandate '${idToRevoke}' successfully revoked. No further autonomous debits permitted.`,
      mandate: revoked,
      metrics: settlementGateway.getMetrics()
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mandates/reset
 * Seeds a fresh ₹5,000 mandate for demonstration and test runs
 */
app.post('/api/mandates/reset', (req: Request, res: Response) => {
  try {
    const { amountPaise } = req.body;
    const resetMandate = settlementGateway.seedDefaultMandate(amountPaise || 500000);

    res.json({
      success: true,
      message: 'Demo mandate and ledger re-initialized to initial reserve state.',
      mandate: resetMandate,
      metrics: settlementGateway.getMetrics()
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Serve static frontend assets from public/
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Fallback to index.html for SPA routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Start server when executed directly
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`\n========================================================`);
    console.log(`⚡ Razorpay ReserveEngine running!`);
    console.log(`📡 Console URL: http://localhost:${port}`);
    console.log(`🏛️  NPCI Protocol: UPI Reserve Pay (SBMD v1.4)`);
    console.log(`🛡️  Financial Guardrails: ACTIVE (Integer Paise Math)`);
    console.log(`🔐 Cryptographic Proofs: HMAC-SHA256 (Razorpay Secret)`);
    console.log(`========================================================\n`);
  });
}

export default app;
