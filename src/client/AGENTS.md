# Client Agent Guidance

These rules apply to work under `src/client/`.
Follow the root `AGENTS.md` first and use `docs/development-index.md` for the module map.

## Placement

- Keep `App.vue` limited to application composition and top-level coordination.
- Do not add new business logic, feature state machines, or large templates to `App.vue`.
- Put reusable presentation in focused components.
- Put reusable stateful behavior in composables.
- Put domain-specific UI and state in feature modules.
- Keep API calls behind the existing client API boundary.
- Keep shared DTO assumptions aligned with `src/shared/`.
- Prefer extending an existing focused module over creating a second implementation.

## Change Discipline

- Locate the relevant component, composable, helper, and test before editing.
- Read targeted symbols or template sections instead of scanning all of `App.vue`.
- Preserve current navigation, loading, empty, error, and permission states.
- Do not combine a feature change with unrelated CSS cleanup.
- Do not rename global selectors or layout primitives without tracing all consumers.
- Avoid broad visual restyling unless the task explicitly requests it.
- Preserve accessible labels, focus order, keyboard access, and visible focus.

## Responsive UI

- Check changed mobile UI at widths of 360px and 390px.
- Check changed desktop UI at a width of at least 1280px.
- Preserve safe-area padding around fixed headers, composers, controls, and dialogs.
- Verify soft-keyboard behavior does not hide the composer or active field.
- Keep modal headers and close controls visible.
- Keep long modal content scrolling inside the modal rather than behind it.
- Preserve outside-click, explicit-close, Escape, and back behavior where supported.
- Check long text, narrow controls, and disabled or loading states for overflow.

## Animation and Effects

- Every animation must have explicit start, pause, resume, and destroy behavior.
- Pause timers, frames, observers, and physics when content is hidden or offscreen.
- Destroy animation resources on component unmount and page lifecycle exit.
- Do not let background views retain active animation work.
- Prefer `transform` and `opacity` over layout-changing animation.
- Keep animated movement from changing message height or scroll position.
- Add focused lifecycle coverage when animation behavior changes.

## Validation

- Run the most relevant focused UI logic test while iterating.
- Run `npm run test:ui-logic` for client logic or interaction changes.
- Run `npm run check` for Vue or TypeScript changes.
- Run `npm run build` when client code or build behavior changes.
- Use a real browser for changed responsive, keyboard, modal, or gesture behavior.
- Record any viewport or browser behavior that could not be verified as a remaining risk.

## Review

- Review the client-only diff for accidental server, release, or schema changes.
- Confirm no unrelated CSS was reformatted.
- Confirm new logic has a focused owner outside `App.vue`.
- Follow the root guidance for final diff review and reporting.
