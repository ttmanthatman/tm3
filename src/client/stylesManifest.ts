import { readFileSync } from "node:fs";

/**
 * Ordered list of the domain files that src/client/styles.css concatenates via
 * @import. Keep in sync with the @import order in styles.css: cascade order is
 * load-bearing, so new domain files must be appended in the same position in
 * both places.
 *
 * Node-only helper for source-assertion tests (run through tsx); never import
 * this from application code.
 */
export const STYLE_DOMAIN_FILES = [
  "tokens.css",
  "ai-settings.css",
  "shell.css",
  "music-lyrics.css",
  "chat-tools.css",
  "music-player.css",
  "sidebar.css",
  "chat-pane.css",
  "messages.css",
  "message-content.css",
  "prayer.css",
  "grace.css",
  "composer.css",
  "members.css",
  "modals.css",
  "admin.css",
  "appearance.css",
  "theme-admin.css",
  "admin-accounts.css",
  "dialogs.css",
  "keyframes.css",
  "responsive.css",
  "ai-roles.css",
  "music-manager.css",
  "sermon.css"
] as const;

export function readClientStyles(): string {
  return STYLE_DOMAIN_FILES.map((file) => readFileSync(new URL(`./styles/${file}`, import.meta.url), "utf8")).join("\n");
}
