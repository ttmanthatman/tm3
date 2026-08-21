import type { MessageDTO } from "../../shared/types.js";
import { renderWeChatRelayNotification } from "../../shared/wechatRelayNotifications.js";

export function formatRelayMessage(message: MessageDTO) {
  const serverText = (message as MessageDTO & { relayText?: unknown }).relayText;
  if (typeof serverText === "string" && serverText.trim()) return serverText.trim();
  return renderWeChatRelayNotification(message);
}
