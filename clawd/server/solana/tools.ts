import { isJupiterSwapRoutedTool } from "./jupiter-swap-tools.ts";
import type { JupiterSwapService } from "./jupiter-swap.ts";
import { executePumpRoutedTool, isPumpRoutedTool, type PumpTapeStore } from "./pump-tape.ts";
import { executeSolanaRoutedTool, isSolanaRoutedTool, type SolanaToolPort } from "./solana-routed-tools.ts";
import { JUPITER_SWAP_ROUTED_TOOLS } from "./jupiter-swap-tools.ts";
import { PUMP_ROUTED_TOOLS } from "./pump-tape.ts";
import { SOLANA_ROUTED_TOOLS, type RoutedToolDefinition } from "./solana-routed-tools.ts";

export const SOLANA_FAMILY_TOOLS: readonly RoutedToolDefinition[] = [
  ...SOLANA_ROUTED_TOOLS,
  ...PUMP_ROUTED_TOOLS,
  ...JUPITER_SWAP_ROUTED_TOOLS,
];

export function isSolanaFamilyTool(name: unknown): name is string {
  return isSolanaRoutedTool(name) || isPumpRoutedTool(name) || isJupiterSwapRoutedTool(name);
}

export interface SolanaFamilyPorts {
  solana: SolanaToolPort;
  jupiter: JupiterSwapService;
  pumpStore: PumpTapeStore;
  pumpEnv?: NodeJS.ProcessEnv;
  pumpFetch?: typeof fetch;
}

export async function executeSolanaFamilyTool(ports: SolanaFamilyPorts, name: string, args: unknown): Promise<unknown> {
  if (isSolanaRoutedTool(name)) return executeSolanaRoutedTool(ports.solana, name, args);
  if (isPumpRoutedTool(name)) {
    return executePumpRoutedTool(name, args, {
      store: ports.pumpStore,
      env: ports.pumpEnv,
      fetchImpl: ports.pumpFetch,
    });
  }
  if (isJupiterSwapRoutedTool(name)) return ports.jupiter.executeTool(name, args);
  throw new Error(`Unknown Solana family tool: ${name}`);
}
