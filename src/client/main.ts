import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import { APP_VERSION } from "@shared/release";
import { getAppViewportHeight } from "./viewport";

function syncViewportHeight() {
  const vv = window.visualViewport;
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
  const active = document.activeElement;
  const editing = active instanceof HTMLElement && (
    active.isContentEditable || active.matches("textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio])")
  );
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const height = getAppViewportHeight({
    layoutHeight, visualHeight: vv?.height, visualOffsetTop: vv?.offsetTop, standalone, editing
  });
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  document.documentElement.style.setProperty("--keyboard-offset", "0px");
}

syncViewportHeight();
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("scroll", syncViewportHeight);
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("pageshow", syncViewportHeight);
document.addEventListener("focusin", syncViewportHeight);
document.addEventListener("focusout", syncViewportHeight);

document.addEventListener(
  "gesturestart",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false }
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, { updateViaCache: "none" }).catch(() => {});
  });
}

createApp(App).use(createPinia()).mount("#app");
