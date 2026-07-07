# Bubble Lab

This folder is the home for isolated chat bubble style prototypes.

Goals:

- develop one visual effect at a time
- avoid reading or changing the main chat during prototype work
- compare small variants quickly
- keep screenshots and acceptance criteria focused
- integrate into the main chat only after the effect is approved

Preferred future structure:

```text
bubble-lab/
  BubbleLab.vue
  effects/
    flame/
      FlameEffectCanvas.vue
      firePhysics.ts
      palette.ts
      README.md
```

Current temporary flame lab:

- `src/client/FlamePrototype.vue`
- route: `/prototype/flame`

When starting a new bubble-style conversation, ask Codex to follow `src/client/effects/BUBBLE_LAB_CONTEXT.md` and work inside the lab unless integration is explicitly requested.
