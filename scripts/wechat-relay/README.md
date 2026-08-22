# WeChat relay deployment

This optional tool watches one Team Chat channel and sends its messages to one fixed WeChat group through the visible official Linux WeChat client. It does not use unofficial WeChat protocols, process injection, hooks, hidden APIs, or detection-evasion behavior.

## VM baseline

- Ubuntu 22.04 LTS with an XFCE X11 desktop at 1280x720.
- One dedicated desktop user named `wechat-relay` with automatic desktop login.
- Official x86_64 Linux WeChat client.
- Node.js 22, `xdotool`, `xclip`, `scrot`, and `xdg-utils`.
- No public inbound service port is required.

Build the repository with `npm ci` and `npm run build:server`. Copy `config.example.env` to `/etc/wechat-relay.env` and set permissions to `0600`. The initial file must exist before using the setup app. Never commit it or a device token. The server stores only a salted one-way verifier for an administrator-managed token. The legacy server environment variable `WECHAT_RELAY_AGENT_TOKEN` remains supported when no administrator token is present.

Install `policykit-1` so the desktop session has `pkexec`, then copy `wechat-relay-setup.desktop` to both the relay user's desktop and application menu:

```bash
relay_user_home="$(getent passwd wechat-relay | cut -d: -f6)"
test -n "$relay_user_home"
install -d -m755 -o wechat-relay -g wechat-relay "$relay_user_home/Desktop" "$relay_user_home/.local/share/applications"
install -m755 -o wechat-relay -g wechat-relay scripts/wechat-relay/wechat-relay-setup.desktop "$relay_user_home/Desktop/wechat-relay-setup.desktop"
install -m755 -o wechat-relay -g wechat-relay scripts/wechat-relay/wechat-relay-setup.desktop "$relay_user_home/.local/share/applications/wechat-relay-setup.desktop"
```

To connect or switch sites, open **微信转发连接设置** on the VM desktop. In **管理中心 → 微信通知转发**, generate or enter a device token, click **复制 NAS 配置**, paste the two lines into the setup app, and click **验证并连接**. After the production site accepts the token, the desktop asks once for the VM administrator password, updates `/etc/wechat-relay.env`, selects a site-specific queue database, and restarts `wechat-relay.service`. If restart fails, it restores the previous configuration. The token is sent to the helper through standard input, never a process argument.

The setup page listens on a random `127.0.0.1` port and closes automatically. It is intentionally unavailable from the NAS LAN address. The operator still needs to keep the official WeChat client logged in inside the VM; the setup app does not automate WeChat login.

Administrators choose the source channel, target-group label, binding, test send, enablement, and reminder wording from **管理中心 → 微信通知转发**. Reminder variants are one per line and may use `{name}` plus `{kind}` for attachments. The server chooses a stable variant for each message and sends only the conversational reminder—never the message body, source ID, or timestamp. The NAS reports its heartbeat, local queue counts, binding result, and last error to that page. It makes outbound HTTPS requests only; no NAS inbound port is required.

Set `WECHAT_RELAY_NAS_ACCESS_URL` on the Team Chat server to the administrator-only browser page used to operate the NAS VM desktop (for example, its existing VM console or noVNC gateway). The admin panel links to that page and reminds the operator that official WeChat must be logged in with the account responsible for forwarding notifications. This link does not replace `RELAY_BASE_URL` or `RELAY_AGENT_TOKEN`, and it must not contain embedded credentials.

Copy `wechat-relay.desktop` to the desktop account's `~/.config/autostart/` directory. Copy `wechat-relay.service` to `/etc/systemd/system/`, then reload systemd. The service deliberately uses a writable `/var/lib/wechat-relay` directory and otherwise has a restricted filesystem view. Each normalized site URL receives a different SQLite path under `/var/lib/wechat-relay`, so a cursor recorded against a demo site cannot skip production messages.

## Calibration

1. Log in to the official client manually and open the one target group.
2. Keep the WeChat window unobscured and do not open another chat.
3. In **管理中心 → 微信通知转发**, enter the exact group label and click **绑定当前群**.
4. Wait for the page to report the bound group, then use **发送测试消息**.
5. Enable forwarding only after the test is visibly present in the intended group.

The `calibrate` and `doctor` CLI commands remain available for local diagnosis.

Dry-run uses the normal delivery bookkeeping and marks previewed messages as sent. Use a disposable `RELAY_DATABASE_PATH` for rehearsal so that the live relay can perform its own initial catch-up.

The image anchor is a fail-closed target check. If WeChat changes its layout, the relay stops sending until the target group is manually reopened and calibrated again.

## Operations

Use `status` to inspect the source cursor, queue counts, and the source IDs of items needing attention. If a crash or visual verification failure happens after the send key was pressed, the affected message enters `uncertain` state and all further delivery pauses. Inspect the target group, then resolve it explicitly:

```bash
node dist/server/scripts/wechat-relay/main.js resolve 12345 sent
node dist/server/scripts/wechat-relay/main.js resolve 12345 retry
```

The first command records that the message is already visible in WeChat. The second returns it to the queue. This manual boundary prevents an automatic restart from silently duplicating a possibly delivered notification.
