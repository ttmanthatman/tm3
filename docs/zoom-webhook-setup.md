# Zoom meeting status notifications

The site can receive Zoom meeting start/end notifications without joining a meeting or using OAuth API credentials. Manual status remains available when automatic status is disabled.

1. Create a Server-to-Server OAuth app in Zoom App Marketplace. Complete its required information.
2. In **Feature**, enable **Event Subscriptions** and choose **Webhook**.
3. Put the app's **Secret Token** into the site's server environment as `ZOOM_WEBHOOK_SECRET_TOKEN`. Do not place it in frontend code, URLs or tracked files. Restart the application after changing the server environment.
4. Deploy the receiver, then set **Event notification endpoint URL** to `https://<your-site-domain>/api/zoom/webhook`. This endpoint requires public HTTPS; localhost does not work. Select **Validate** and wait for success.
5. Add **Meeting started** (`meeting.started`) and **Meeting ended** (`meeting.ended`). Keep the intended event receiver scope, save the subscription, complete any required **Scopes**, then activate the app under **Activation**. An app icon and public Marketplace listing are unnecessary for an internal integration.
6. Save the intended HTTPS Zoom join link in the site's administrator panel. Open and then end that meeting in Zoom. The header should update on its next visible refresh, normally within 15 seconds after notification delivery.

The receiver verifies HMAC-SHA256 signatures against the original request bytes and checks request timestamps within five minutes. Keep the server clock synchronized. Zoom's initial and recurring URL-validation challenges use the same signed endpoint. Only notifications matching the saved `zoom.us` or `zoomgov.com` join URL affect status; other events are acknowledged and ignored.

Automatic mode starts with **unknown** status until the first matching notification. It does not infer whether an already-running meeting has started. Opening and ending a short test meeting establishes a known baseline. Duplicated or older notifications do not override newer observations; updates persist across restarts. A start observation older than 24 hours without an end becomes unknown, rather than claiming the meeting ended. Notifications can be delayed or missed: this integration reflects the most recent accepted event, not a continuous Zoom API probe. OAuth API reconciliation can be added separately when needed.

With automatic mode enabled, the administrator's long-press dialog shows synchronized status and manual state changes return HTTP 409. Clear the environment variable and restart to restore manual mode. This setting does not modify Zoom's waiting-room, host or join-before-host policies.

Accepted start/end events also create a persistent `system` message in every public standard chat channel. Private channels, direct messages and specialized channels are excluded. The start notice reads “Zoom会议开始了”, links to the saved meeting URL and uses white text on a blue background; the end notice reads “Zoom会议结束了” without a link. Both sit in the normal message timeline and scroll with history. State changes and the entire channel fan-out commit in one database transaction. Per-instance, per-status and per-channel request IDs prevent duplicate rows on retries; Socket.IO broadcasts only committed messages, and a failed broadcast can retry the same IDs. These notices do not invoke AI or send external push notifications. No new table or migration is required.

References: [Zoom webhooks](https://developers.zoom.us/docs/api/webhooks/), [Server-to-Server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/).
