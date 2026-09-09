# Clawd Bot design QA — September 9, 2026

**Findings**

- [P2] Installed VPS help link is stale.
  Location: Settings → Connections → Self-hosted VPS → setup guide.
  Evidence: native accessibility inspection exposes `github.com/milind-soni/Clawd%20Bot/blob/main/docs/byo-vps.md`. Current source `src/components/ApiKeys.tsx` already points to `https://github.com/Solizardking/clawd-bots/blob/main/docs/byo-vps.md`.
  Impact: users of the installed build are sent to the wrong setup documentation.
  Fix: package and install a validated current build, then recheck the link. No source-link substitution is needed.
- Comparison acceptance is blocked by unmatched reference state and capture geometry.
  The archive is an upstream Connections screen; current Clawd uses the selected Solana theme, managed connected apps, extra settings tabs and a different workspace. These intentional product differences must not be treated as pixel defects or reverted to the upstream design.

**Evidence and normalization**

- Source visual truth: `docs/screenshots/app-settings.png`, opened during this run; 2880 × 1800 pixels, original CSS size and device density not recorded.
- Implementation: `/Applications/Clawd Bot.app`, local renderer at `http://127.0.0.1:8799/`, Settings → Connections, Solana theme.
- Implementation screenshot path: unavailable as a persistent file. Native CUA screenshot is embedded in this session's “Capture both Connections views for QA” result. Displayed capture is 1343 × 768 pixels; renderer CSS viewport and backing density are unverified.
- Browser capture attempts: both `iab` and `chrome` reported unavailable. Native Electron capture succeeded.
- Full-view comparison: source PNG and native implementation screenshot were included together in the same tool result. An earlier capture was General rather than Connections and was discarded as a state mismatch; the second capture selected Connections.
- Density normalization: not completed; no 1:1 fidelity verdict is claimed.
- Focused regions: not judged, because reference state and geometry must first be aligned. Native accessibility separately verified the exact link target and control labels.
- Interactions tested: open Settings, select General and Connections; voice setup and synthesis verified through the harness API. No credentials entered through the UI.
- Console errors: not available through this native surface; browser console inspection remains unverified.

**Required fidelity surfaces**

| Surface | Observation and acceptance limit |
| --- | --- |
| Fonts and typography | Both views use readable sans-serif hierarchy. Exact family, weight, wrapping and optical-size comparison remains unverified without matching density/state. |
| Spacing and layout rhythm | Both show a settings navigation rail and scrolling content. Modal size and content density differ with viewport and added features; no numeric drift claim is made. |
| Colors and tokens | Historical reference is neutral dark; installed Clawd intentionally uses Solana purple/green. Preserve the selected product theme. |
| Image quality and asset fidelity | Historical upstream avatars differ from the real Clawd mascot artwork. No source artwork was replaced or approximated in this task. A matched Clawd reference is needed for acceptance. |
| Copy and content | Current managed-app status, AssemblyAI and VPS setup differ from the historical key-only panel. Documentation now describes the current flow. The installed VPS link remains stale. |

**Comparison history**

1. Opened source and native General screen; rejected comparison because tabs differ.
2. Opened Connections and included both images in one comparison input. Confirmed product/state and geometry mismatch; found stale installed help link via the associated accessibility evidence.
3. Source link was already corrected before this task; no visual code fix or post-install capture has been completed. Build/test work is not counted as a visual QA iteration.

**Open Questions**

A current Clawd visual target at a recorded viewport/density is needed to assess fidelity. Historical upstream screenshots are preserved as references, not relabeled as current acceptance captures.

**Implementation Checklist**

1. Install a validated current desktop build and verify the VPS documentation link.
2. Capture source and implementation at matched viewport, theme, state and density, saving both files.
3. Compare full view and readable focused regions, inspect console output, and resolve any P0/P1/P2 findings.

**Follow-up Polish**

None classified before a valid normalized comparison.

The requested [design-qa skill](/Users/8bit/.codex/plugins/cache/openai-curated-remote/product-design/0.1.54/skills/design-qa/SKILL.md) requires: “Use `blocked` when actionable P0/P1/P2 findings remain and name the blocker.” The stale installed help link and missing normalized post-install comparison prevent acceptance here.

final result: blocked
