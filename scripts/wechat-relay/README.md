# WeChat relay deployment

This optional tool watches one Team Chat channel and sends its messages to one fixed WeChat group through the visible official Linux WeChat client. It does not use unofficial WeChat protocols, process injection, hooks, hidden APIs, or detection-evasion behavior.

## VM baseline

- Ubuntu 22.04 LTS with an XFCE X11 desktop at 1280x720.
- One dedicated desktop user named `wechat-relay` with automatic desktop login.
- Official x86_64 Linux WeChat client.
- Node.js 22, `xdotool`, `xclip`, and `scrot`.
- No public inbound service port is required.

Build the repository with `npm ci` and `npm run build:server`. Copy `config.example.env` to `/etc/wechat-relay.env`, set permissions to `0600`, and set `RELAY_BASE_URL` plus a random `RELAY_AGENT_TOKEN` that matches the server's `WECHAT_RELAY_AGENT_TOKEN`. Never commit either value. The agent token is device-scoped and replaces a normal Team Chat username and password.

Administrators choose the source channel, target-group label, binding, test send, and enablement from **管理中心 → 微信通知转发**. The NAS reports its heartbeat, local queue counts, binding result, and last error to that page. It makes outbound HTTPS requests only; no NAS inbound port is required.

`RELAY_MESSAGE_URL_TEMPLATE` is optional. Leave it empty unless the deployed Team Chat instance has a supported message deep-link format; `{channelId}` and `{messageId}` are replaced when configured.

Copy `wechat-relay.desktop` to the desktop account's `~/.config/autostart/` directory. Copy `wechat-relay.service` to `/etc/systemd/system/`, then reload systemd. The service deliberately uses a writable `/var/lib/wechat-relay` directory and otherwise has a restricted filesystem view.

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
