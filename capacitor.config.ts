import type { CapacitorConfig } from "@capacitor/cli";

// 安卓壳通过 server.url 直接加载部署好的网页端：页面与 API 同源，
// 网页发版后 APK 无需重新构建。本地联调时用 CAP_SERVER_URL 指向本机服务，
// 例：CAP_SERVER_URL=http://localhost:5173 npx cap sync android（配合 adb reverse tcp:5173 tcp:5173）。
const serverUrl = process.env.CAP_SERVER_URL ?? "https://liao.xiaogushi.us";

const config: CapacitorConfig = {
  appId: "us.xiaogushi.liao",
  appName: "聊天室",
  webDir: "dist",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://")
  }
};

export default config;
