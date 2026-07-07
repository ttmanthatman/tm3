# Bubble Lab Context

Purpose: prototype chat bubble visual effects without spending tokens on the full chat application. Use this file as the first stop when a task is about designing, tuning, or comparing bubble styles.

## Default Token Rule

When the user asks to develop a bubble style, treat it as prototype work unless they explicitly ask to integrate it into the main chat.

For prototype work, read only:

- `src/client/effects/BUBBLE_LAB_CONTEXT.md`
- `src/client/effects/bubble-lab/README.md`
- the current bubble lab component or route
- files under the current effect folder

Do not read `src/client/App.vue`, store code, socket code, server code, or database code during prototype work unless the user asks for integration or the lab cannot run without a tiny known detail.

## Current Lab

The active temporary route is:

- URL: `/prototype/flame`
- Component: `src/client/FlamePrototype.vue`

Future work should move this into:

- `src/client/effects/bubble-lab/BubbleLab.vue`
- `src/client/effects/bubble-lab/effects/<effect-name>/`

Until that move happens, keep flame prototype changes scoped to `src/client/FlamePrototype.vue`.

## Bubble DOM Contract

Prototype effects should assume this minimal bubble contract:

- row: `.message-row`
- own row modifier: `.message-row.mine`
- bubble: `.bubble`
- effect class: `.message-effect-<name>`
- bubble content must remain readable
- effects may use an overlay canvas or SVG layer, but the bubble remains the hit target

Prototype code should not depend on real messages, auth, sockets, uploads, channels, or database state.

## Inputs An Effect May Expect

Design prototype effects around these inputs:

- `messageId`
- `bubbleRect`
- `isMine`
- `isPaused`
- `effectName`
- optional pointer events
- optional localized hit events, such as water drops landing at `{ x, y }`
- optional temporary boost state, such as `stokedUntil`

## Prototype Acceptance Checklist

For every bubble effect iteration, verify:

- desktop screenshot
- mobile screenshot around 390px width
- text remains readable
- controls do not overlap
- effect does not resize the bubble or shift the layout
- paused/default/intensified states are visually distinct when relevant
- local interactions affect only the intended region when relevant

## Integration Gate

Only read the main chat and integrate when the user says something like:

- "并入主聊天室"
- "接入真实聊天室"
- "把这个作为 /火焰 效果"
- "发布这个气泡样式"

At integration time, read only the necessary main chat points:

- effect command list
- message effect class mapping
- message bubble DOM
- shared overlay layer, if needed
- pointer or localized hit event wiring, if needed

Keep the effect engine separate from chat business logic.
