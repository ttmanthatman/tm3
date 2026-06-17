import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";

function syncViewportHeight() {
  const vv = window.visualViewport;
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
  const visibleHeight = vv ? Math.max(320, Math.floor(vv.height + vv.offsetTop)) : layoutHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.min(layoutHeight, visibleHeight)}px`);
  document.documentElement.style.setProperty("--keyboard-offset", "0px");
}

syncViewportHeight();
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("scroll", syncViewportHeight);
window.addEventListener("resize", syncViewportHeight);

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
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}

createApp(App).use(createPinia()).mount("#app");
