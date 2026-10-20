import assert from "node:assert/strict";
import test from "node:test";
import { notifyNativeAppReady, setupNativeShell, type NativeBridge } from "./nativeShell.js";

interface BridgeCall {
  kind: "exitApp" | "hide" | "setBackgroundColor" | "setStyle" | "addListener";
  detail?: { event?: string; color?: string; style?: string };
}

function fakeWindow(bridge?: NativeBridge): Window {
  return { Capacitor: bridge } as unknown as Window;
}

function recordingBridge(): { bridge: NativeBridge; calls: BridgeCall[]; emitBack: () => void } {
  const calls: BridgeCall[] = [];
  let backHandler: ((state?: { canGoBack?: boolean }) => void) | undefined;
  const bridge: NativeBridge = {
    isNativePlatform: () => true,
    Plugins: {
      App: {
        exitApp: () => calls.push({ kind: "exitApp" }),
        addListener: (event, callback) => {
          calls.push({ kind: "addListener", detail: { event } });
          backHandler = callback;
          return { remove: () => {} };
        }
      },
      StatusBar: {
        setBackgroundColor: async (options) => {
          calls.push({ kind: "setBackgroundColor", detail: { color: options.color } });
        },
        setStyle: async (options) => {
          calls.push({ kind: "setStyle", detail: { style: options.style } });
        }
      },
      SplashScreen: {
        hide: async () => {
          calls.push({ kind: "hide" });
        }
      }
    }
  };
  return {
    bridge,
    calls,
    emitBack: () => {
      assert.ok(backHandler, "backButton listener was never registered");
      backHandler({ canGoBack: false });
    }
  };
}

test("setup stays silent when no Capacitor bridge is injected", () => {
  assert.doesNotThrow(() => setupNativeShell({ onBackButton: () => true }));
  assert.doesNotThrow(() => setupNativeShell({ onBackButton: () => true }, fakeWindow()));
  notifyNativeAppReady();
  notifyNativeAppReady(fakeWindow());
});

test("native back button consumes overlays first and exits only when nothing is open", () => {
  const shell = recordingBridge();
  let overlayOpen = true;
  setupNativeShell({ onBackButton: () => overlayOpen }, fakeWindow(shell.bridge));

  shell.emitBack();
  assert.deepEqual(
    shell.calls.filter((call) => call.kind === "exitApp"),
    [],
    "overlay open must not exit the app"
  );

  overlayOpen = false;
  shell.emitBack();
  assert.equal(shell.calls.filter((call) => call.kind === "exitApp").length, 1);
});

test("setup styles the status bar for the light chat theme", () => {
  const shell = recordingBridge();
  setupNativeShell({ onBackButton: () => false }, fakeWindow(shell.bridge));
  const colorCall = shell.calls.find((call) => call.kind === "setBackgroundColor");
  const styleCall = shell.calls.find((call) => call.kind === "setStyle");
  assert.equal(colorCall?.detail?.color, "#ededed");
  assert.equal(styleCall?.detail?.style, "LIGHT");
});

test("app ready hides the native splash screen", () => {
  const shell = recordingBridge();
  notifyNativeAppReady(fakeWindow(shell.bridge));
  assert.equal(shell.calls.filter((call) => call.kind === "hide").length, 1);
});
