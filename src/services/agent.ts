import { runCommerceAgent, CommerceAgentResult } from '../agent/commerceAgent.js';

export { runCommerceAgent, CommerceAgentResult };

export interface AgentRunParams {
  message: string;
  maxBudgetPaise?: number;
}

export async function runAgent(params: AgentRunParams): Promise<CommerceAgentResult> {
  return runCommerceAgent(params.message, params.maxBudgetPaise);
}
