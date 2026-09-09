# Cheshire Terminal Current Site Reference

Snapshot date: 2026-07-03.

Sources checked:

- `https://cheshireterminal.ai` HTML metadata and inline scripts.
- Current app bundle `/assets/index-BcEveqcj.js`.

## Canonical Public Surface

- Site: `https://cheshireterminal.ai`
- Product claim from HTML metadata: voice-controlled Solana terminal for meme token launch, agent staking, and AI-native terminal workflows.
- Network in bundle defaults: `mainnet-beta`.
- Public RPC route in bundle: `https://cheshireterminal.ai/api/solana/rpc`.

## $CLAWD Addresses

- `$CLAWD` token mint: `8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump`
- Evidence: the current app bundle defines this as the `Fl` constant adjacent to `clawdBalance`, token gating, wallet intel, and `$CLAWD` verification state.
- Token gate threshold observed in bundle: `100000` `$CLAWD`.
- Treasury/payment address observed in bundle: `HKBX8CwMGwnwtFjTH99xKa82whjowqxzsBQGWT3kBhDJ`
- Treasury payment amount observed in bundle: `0.0006942 SOL`.

Before sending a transaction, re-verify the mint and treasury address from a fresh source or user-provided authority.

## Voice And Swap Integrations

- LiveKit public agent ID from inline HTML script: `CA_xk8hpixq4g6K`
- LiveKit embed logo path: `/8bit_logo.png`
- Jupiter plugin script: `https://plugin.jup.ag/plugin-v1.js`

Use LiveKit for voice session UX and Jupiter for quote/swap UX. Do not treat either as proof that a transaction succeeded; confirm on-chain signatures separately.

## Current Feature Modules

The current bundle exposes modules for these Cheshire/Clawd surfaces:

- Terminal and voice: `FreeTerminalPage`, `VoiceCommands`, `LiveSpotTradingTerminal`, `VoicePage`, `AssemblyVoiceAgent`, `xaiVoice`, `VoiceToPrompt`.
- Token actions: `ClawdBuyPanel`, `ClawdSwapWidget`, `ClawdTokenAction`, `burn`, `TokenTicker`, `BurnTicker`, `StakingPage`, `TreasuryPage`, `MyBurnsPage`, `HoldersDirectoryPage`.
- Trading: `DFlowMarketsPage`, `DFlowOODAPage`, `PhoenixPerpsPage`, `DexPage`, `TradingPage`, `WalletScannerPage`, `ImperialDeskPage`, `PumpPage`, `ContractExplorer`.
- Agents: `AgentLaunchpadPage`, `AgentExplorerPage`, `AgentBuilderPage`, `AgentTemplatesPage`, `AgentsHubPage`, `AgentChatPage`, `AgentDetailPage`, `DeployedAgentDetailPage`, `AgentRuntimeMatrixPage`, `AgentArenaPage`, `ClawdArenaPage`.
- AI/media: `ClawdGrokPage`, `ClawdCodePage`, `DeepSeekPage`, `HermesPage`, `BrowserUsePage`, `VideoGenPage`, `StreamPage`, `MetaplexAgentPage`, `NftStudioPage`, `ImagineStudioPage`, `GeminiStudioPage`, `GalleryPage`.
- Ops/admin: `UsagePage`, `ApiCatalogPage`, `RouterKeysPage`, `DeployPage`, `BackroomPage`, `AccountPage`, `TelegramLinkPage`, `RemoteControlPage`, `DiscordPage`, `NewsFeedPage`.

Use the specific Clawd skills for token ops, launchpad work, or trading terminal work when the task focuses on one of those areas.
