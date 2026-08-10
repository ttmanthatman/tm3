# 0001. Handwriting messages stored as stroke vectors, not rendered video

## Status

Accepted (2026-08-10)

## Context

We are adding 手写消息 (handwriting messages): the user writes characters by
finger on a writing pad, and recipients see the full writing animation replayed,
not just the finished result. The animation data must be stored per message and
transmitted to all clients.

The obvious cheap option was to record the finished writing as a WebM/GIF file
and send it through the existing file-upload pipeline. The alternative is to
store the raw stroke data (per character: normalized coordinate points with
timestamps) in the message `payload` as JSON, and replay it on a canvas in each
client.

## Decision

Store handwriting messages as stroke vector JSON in `Message.payload` under a
new `MessageType.handwriting`. Do not render video or GIF server- or
client-side. Clients replay the animation on a canvas.

## Consequences

- Payloads stay small (kilobytes per message; 30-character cap keeps the worst
  case around ~250KB) and replay stays crisp at any size.
- Replay can compress long thinking pauses (>1s down to ~0.5s) without touching
  the recorded data.
- The per-character stroke structure can be reused by 圣经抄写 (Bible copying),
  where the target character is known and stroke-level completion detection
  becomes possible.
- Cost: a Prisma migration for the new enum value, a new canvas renderer and
  composer UI on the client, and version tolerance for the payload schema in
  persisted messages.
- Static contexts that cannot animate (push notification text, message list
  previews) fall back to a plain-text label such as "[手写消息]".
