import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, expect, test, webkit, type Page } from "@playwright/test";
import { compileStyle, parse } from "@vue/compiler-sfc";
import { readClientStyles } from "../../src/client/stylesManifest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const icon = (size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="currentColor" /></svg>`;
const button = (className: string, content = icon()) => `<button type="button" class="${className}" data-align>${content}</button>`;
const fixtures: Array<{ source?: string; html: string }> = [
  { html: ["icon-btn", "favorite-remove", "channel-row-action", "pin-toggle", "message-select-btn", "inline-audio-play", "voice-play", "preview-play", "mini-icon-btn", "preview-control", "admin-account-avatar-action", "music-manager-icon-btn", "music-manager-play", "music-manager-heart", "music-score-close", "sermon-overlay-minimize"].map((name) => button(name, icon(name === "admin-account-avatar-action" ? 14 : 20))).join("") },
  { html: `${button("notification-nudge", "打")}<div class="inline-audio-actions">${button("", icon(16))}</div><div class="score-preview-pager">${button("")}</div><div class="music-manager-playlist-actions">${button("", icon(16))}</div><div class="music-manager-score-pages"><figcaption>${button("", icon(14))}</figcaption></div><div class="chat-tools-font-row">${button("", "小")}${button("", "大")}</div><div class="sermon-font-stepper">${button("", icon(15))}</div>` },
  { source: "src/client/components/BibleWorkspace.vue", html: `<div class="bible-topbar-actions">${button("bible-resource-link", icon(19))}<div class="bible-font-control">${button("bible-font-trigger", "字")}</div>${button("bible-topbar-button layout-control")}</div><div class="bible-font-stepper">${button("", "小")}${button("", "大")}</div><div class="bible-chapter-grid">${button("", "119")}</div>` },
  { source: "src/client/components/BibleReaderPane.vue", html: button("bible-pane-icon", icon(16)) },
  { source: "src/client/components/AdminResourceManager.vue", html: `<div class="resource-actions">${button("", icon(18))}</div><div class="resource-preview"><header>${button("")}</header></div>` },
  { source: "src/client/features/bible/notes/NoteViewer.vue", html: button("note-tools") },
  { source: "src/client/features/bible/copywork/CopyworkViewer.vue", html: button("viewer-icon") },
  { source: "src/client/features/chain/ChainCreateDialog.vue", html: `<div class="chain-option-item">${button("", icon(16))}</div>` },
  { source: "src/client/features/chat/MessageSearchWindow.vue", html: button("message-search-floating-close", icon(14)) },
  { source: "src/client/features/handwriting/HandwritingPalette.vue", html: `<div class="handwriting-picker"><header>${button("", icon(18))}</header></div>` },
  { source: "src/client/features/stories/stories.css", html: `<div class="story-surface">${button("story-back", icon(21))}${button("story-voice-play")}${button("story-comment-delete", icon(14))}<div class="story-comment-replying">${button("", icon(14))}</div>${button("story-remove-image", icon(16))}<div class="story-comment-form">${button("", icon(18))}</div></div>` }
];

async function mountButtons(page: Page, nativePaddingStress: boolean) {
  // Load production CSS in its real cascade order. Keep SFC styles scoped so
  // local button rules cannot leak into unrelated fixtures.
  let css = readClientStyles();
  const html = fixtures.map(({ source, html }, index) => {
    const scope = `data-v-align-${index}`;
    if (source?.endsWith(".vue")) {
      const filename = path.join(ROOT, source);
      const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
      for (const style of descriptor.styles) {
        const compiled = compileStyle({ source: style.content, filename, id: scope, scoped: style.scoped });
        if (compiled.errors.length) throw new Error(compiled.errors.map(String).join("; "));
        css += `\n${compiled.code}`;
      }
    } else if (source) css += `\n${fs.readFileSync(path.join(ROOT, source), "utf8")}`;
    return `<section data-fixture="${scope}">${html}</section>`;
  }).join("");
  // A lower-priority, wider native padding models older iPad control metrics.
  // This is a robustness probe, not a claim to emulate a physical iPad's UA CSS.
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${nativePaddingStress ? "button { padding: 2px 1em 3px; }" : ""}</style><style>${css}</style><style>[data-fixture] { position: relative; padding: 8px; min-height: 100px; } body { overflow: auto; } </style>${html}`);
  await page.locator("[data-fixture]").evaluateAll((sections) => {
    for (const section of sections) {
      const attribute = section.getAttribute("data-fixture")!;
      for (const element of [section, ...section.querySelectorAll("*")]) element.setAttribute(attribute, "");
    }
  });
}

async function expectCentered(page: Page) {
  const measurements = await page.locator("button[data-align]").evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    const svg = button.querySelector("svg");
    const range = document.createRange();
    range.selectNodeContents(button);
    const content = svg?.getBoundingClientRect() ?? range.getBoundingClientRect();
    return {
      name: `${button.closest("[data-fixture]")?.getAttribute("data-fixture")}: ${button.className || button.parentElement?.className} ${button.textContent}`,
      dx: Math.abs(content.x + content.width / 2 - bounds.x - bounds.width / 2),
      dy: Math.abs(content.y + content.height / 2 - bounds.y - bounds.height / 2),
      overflows: content.left < bounds.left - 1 || content.right > bounds.right + 1
    };
  }));
  expect(measurements.length).toBeGreaterThan(40);
  for (const measurement of measurements) {
    expect(measurement.dx, measurement.name).toBeLessThanOrEqual(1);
    expect(measurement.dy, measurement.name).toBeLessThanOrEqual(2);
    expect(measurement.overflows, measurement.name).toBe(false);
  }
}

for (const engine of [chromium, webkit]) {
  test(`${engine.name()}: fixed-size buttons keep text and icons centered across phone, iPad and desktop widths`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ ...devices["iPad (gen 7)"] });
      for (const width of [360, 390, 768, 1024, 1378]) {
        await page.setViewportSize({ width, height: 1118 });
        for (const nativePaddingStress of [true, false]) {
          await mountButtons(page, nativePaddingStress);
          await expectCentered(page);
          await page.locator("button[data-align]").evaluateAll((buttons) => {
            for (const button of buttons) (button as HTMLButtonElement).disabled = true;
          });
          await expectCentered(page);
        }
      }
    } finally {
      await browser.close();
    }
  });
}
