import "dotenv/config";
import { buildApp } from "./index.js";

const port = Number(process.env.PORT || 3003);
const host = "0.0.0.0";
const app = await buildApp();
let isClosing = false;

async function closeApp(signal: NodeJS.Signals) {
  if (isClosing) return;
  isClosing = true;
  app.log.info({ signal }, "shutting down server");
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "failed to close server");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void closeApp("SIGINT");
});
process.once("SIGTERM", () => {
  void closeApp("SIGTERM");
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, "failed to start server");
  await app.close();
  process.exitCode = 1;
}
