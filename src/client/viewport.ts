interface AppViewport {
  layoutHeight: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  standalone: boolean;
  editing: boolean;
}

export function getAppViewportHeight(viewport: AppViewport): number {
  const { layoutHeight, visualHeight, visualOffsetTop = 0, standalone, editing } = viewport;
  if (visualHeight === undefined) return layoutHeight;

  // Home Screen apps can report a visual viewport shorter by the status-bar
  // inset even without a keyboard. Do not turn that discrepancy into a footer
  // gap. A focused editor plus a substantial reduction indicates a keyboard.
  const keyboardOpen = editing && layoutHeight - visualHeight > 100;
  if (standalone && !keyboardOpen) return layoutHeight;
  return Math.min(layoutHeight, Math.max(1, Math.floor(visualHeight + visualOffsetTop)));
}
