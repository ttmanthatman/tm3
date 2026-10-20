// 与安卓壳（Capacitor server.url 模式）协作的原生能力入口。
// 网页端没有注入的 Capacitor 桥，所有调用都必须优雅退化为无操作，
// 因此这里只通过 window.Capacitor 动态探测，不引入任何原生依赖包。

interface NativeAppPlugin {
  exitApp?: () => void;
  addListener?: (
    event: "backButton",
    callback: (state?: { canGoBack?: boolean }) => void
  ) => { remove: () => void };
}

interface NativeStatusBarPlugin {
  setBackgroundColor?: (options: { color: string }) => Promise<void>;
  setStyle?: (options: { style: "LIGHT" | "DARK" | "DEFAULT" }) => Promise<void>;
}

interface NativeSplashScreenPlugin {
  hide?: (options?: { fadeOutDuration?: number }) => Promise<void>;
}

export interface NativeBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: NativeAppPlugin;
    StatusBar?: NativeStatusBarPlugin;
    SplashScreen?: NativeSplashScreenPlugin;
  };
}

declare global {
  interface Window {
    Capacitor?: NativeBridge;
  }
}

const THEME_COLOR = "#ededed";

function hostWindow(source?: Window): Window | undefined {
  if (source) return source;
  return typeof window === "undefined" ? undefined : window;
}

export function nativeBridge(source?: Window): NativeBridge | undefined {
  return hostWindow(source)?.Capacitor;
}

export function isNativeShell(source?: Window): boolean {
  const bridge = nativeBridge(source);
  return !!bridge?.isNativePlatform?.();
}

/**
 * 返回 True 表示返回事件已被界面的浮层/面板消费；
 * 返回 False 时由原生侧按默认行为退出应用。
 */
export type NativeBackConsumer = () => boolean;

export function setupNativeShell(
  options: { onBackButton: NativeBackConsumer },
  source?: Window
): void {
  const bridge = nativeBridge(source);
  if (!bridge?.isNativePlatform?.()) return;
  const app = bridge.Plugins?.App;
  app?.addListener?.("backButton", () => {
    if (!options.onBackButton()) app.exitApp?.();
  });
  const statusBar = bridge.Plugins?.StatusBar;
  // 主题色是浅色，状态栏文字用深色图标保持可读。
  void statusBar?.setBackgroundColor?.({ color: THEME_COLOR })?.catch?.(() => {});
  void statusBar?.setStyle?.({ style: "LIGHT" })?.catch?.(() => {});
}

export function notifyNativeAppReady(source?: Window): void {
  const bridge = nativeBridge(source);
  if (!bridge?.isNativePlatform?.()) return;
  void bridge.Plugins?.SplashScreen?.hide?.()?.catch?.(() => {});
}
