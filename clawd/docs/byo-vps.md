# Give Clawd Bot a desktop on your VPS

Clawd Bot can manage a Linux desktop container on a server you own. The agent runs on your Clawd Bot computer; Docker commands reach the VPS over SSH. Each bot gets a separate managed container and an optional live viewer.

## Prepare the connection

You need a local Docker CLI with SSH transport, an x86_64 Linux VPS running Docker, and an SSH user that can access the remote Docker daemon without sudo. Docker access is root-equivalent on the VPS; use a dedicated machine appropriate for the bot's work.

Add a named host to `~/.ssh/config`, substituting your host and user:

```sshconfig
Host my-vps
  HostName 203.0.113.7
  User deploy
  IdentityFile ~/.ssh/id_ed25519
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h-%p
  ControlPersist 60m
  ServerAliveInterval 15
  ServerAliveCountMax 3
  ConnectTimeout 10
```

Multiplexing avoids a new handshake for every action. Keepalives and a connection timeout bound failures when the server becomes unreachable. Establish and verify the host key yourself, then check Docker access:

```sh
ssh my-vps true
docker -H ssh://my-vps info
```

In **App Settings → Connections**, save `my-vps` as the SSH alias. Clawd Bot stores the alias, not your private key or passphrase. SSH manages authentication. Paired phones do not receive the alias.

## Assign a computer

Choose **Cloud** and the **Self-hosted VPS** backend for the bot. Provisioning builds the pinned Cua image if needed, creates the bot's managed container, starts it, and waits for the desktop to become ready.

| Action | Result |
| --- | --- |
| Provision | Prepare the image and create or start the managed container. |
| Start | Wake an existing stopped container. |
| Sleep | Stop the container while retaining its filesystem. |
| Take control | Open a temporary SSH-tunneled viewer bound to local loopback. |
| Remove | Owner-managed Docker removal; permanently removes that container's filesystem. |

Container names use `clawdbot-vps-<bot>-<hash>` and do not depend on display names. Clawd Bot does not automatically delete containers. Preserve any needed work before removal or recreation for an image upgrade.

**Auto** normally attaches only to an already running, verified container. The per-bot **Start VPS automatically** switch permits preparation or startup when needed and defaults to off. If no eligible computer or fallback is available, the turn reports the problem.

## Network and container boundaries

Managed containers publish no ports. The runtime checks ports, mounts, namespaces, resource limits, and hardening before attaching; an unsafe or unmanaged container is refused. The viewer uses the private container address through SSH, binds only to a random `127.0.0.1` port on the desktop, and closes with the viewer. It is desktop-only.

Allow SSH from the networks you intend to use. This feature does not require public VNC, noVNC, or Docker API ports. Treat container storage as disposable and keep durable output elsewhere.

## Troubleshooting

Check the SSH alias first, then `docker -H ssh://my-vps info`, then the Computer panel status. The panel distinguishes missing configuration, unreachable Docker, missing image, missing or stopped container, unsafe container, and a desktop that is not ready. First-time image preparation can take several minutes.

Implementation and checks: [VPS lifecycle](../server/vps-computer.ts), [lifecycle tests](../server/vps-computer.test.ts), and [routing tests](../server/vps-routing.test.ts). For local Linux desktop control, see [Ubuntu desktop](linux-desktop.md).
