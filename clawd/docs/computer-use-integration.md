# Computer and browser use in Clawd Bot

Clawd Bot separates control of your desktop, its embedded browser, and remote computers. Selecting a provider determines which machine receives actions and which permissions apply.

## Runtime ownership

```text
Electron main
  ├─ CUA host → validated cua-driver → local desktop
  ├─ WebContentsView + CDP → embedded browser
  └─ local harness → agent CLI + MCP tools
                       └─ remote computer proxy → configured cloud/VPS computer
```

Electron owns the local CUA driver's lifecycle and permission identity. The harness receives a connection descriptor and exposes the driver's official MCP proxy to eligible agents. Plugins add separate MCP servers; enabling a plugin does not grant arbitrary desktop access.

Relevant source: [CUA host](../electron/cua.mjs), [Linux runtime](../electron/cua-linux-runtime.cjs), and [package resources](../electron-builder.yml).

## Local desktop control

Local input uses the validated CUA driver. On macOS, spawning from Electron preserves the application's permission identity. Screen Recording and Accessibility grants must be available; after permission changes, the driver may need a restart so its process sees the new grants.

The official proxy connects to a host-owned socket:

```text
cua-driver mcp --embedded --socket <socketPath>
```

The host supplies `CUA_DRIVER_EMBEDDED=1` and its bundle identity. The current desktop application ID is `com.clawdbot.app`. Obtain socket paths and executable locations from the host's descriptor; do not hard-code an installed path or start another driver from the server.

Packaged drivers live outside ASAR. Packaging and runtime validation determine which binaries are accepted. A build that launches locally is not evidence of Developer ID signing or notarization; see [releasing](releasing.md).

On supported Ubuntu Xorg systems, the user must enable local control and assign the bot to **This computer**. Wayland local input is held disabled by the implementation's safety gate. Preview-only capture remains a separate permission and capability. Linux Auto does not implicitly select the user's desktop. See [Ubuntu desktop](linux-desktop.md).

## Embedded browser

Electron hosts browser pages in `WebContentsView` and drives them through its CDP interface. Persistent per-bot browser partitions isolate sessions while retaining logins across launches. The browser tool path does not require a second Chromium installation.

Some sign-in providers restrict embedded browsers. Use the supported external authentication flow when that happens. A real-Chrome extension bridge or additional Playwright provider must be explicitly implemented and configured before it can be advertised; the earlier design's browser tiers were proposals, not universal setup instructions.

## Remote computers

Cloud computers and isolated virtual machines have their own lifecycle and authorization. They do not grant permission to control the host desktop. A self-hosted VPS uses Docker over SSH and a local tunnel for its viewer; follow [VPS setup](byo-vps.md).

## Verification

For a provider change, verify permission denial, explicit opt-in, the target machine, screenshot capture, an approved input action, cancellation, and app shutdown. Confirm a view-only preview cannot perform input and that remote permissions cannot authorize the local desktop. Native permissions and input routing require testing on the actual supported OS and session type; fake-driver tests alone cannot prove them.
