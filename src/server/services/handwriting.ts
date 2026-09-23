import {
  HANDWRITING_CONTENT,
  HandwritingValidationError,
  normalizeHandwritingPayload,
  type HandwritingPayload
} from "../../shared/handwriting.js";

export type PreparedHandwritingMessage = {
  content: typeof HANDWRITING_CONTENT;
  payload: HandwritingPayload;
};

export function prepareHandwritingMessage(payload: unknown, clientRequestId?: string): PreparedHandwritingMessage {
  if (!clientRequestId) throw new HandwritingValidationError("invalid_shape", "手写消息必须带发送请求标识");
  return { content: HANDWRITING_CONTENT, payload: normalizeHandwritingPayload(payload) };
}

export function normalizeHandwritingForStorage(type: unknown, payload: unknown): unknown {
  return type === "handwriting" ? normalizeHandwritingPayload(payload) : payload;
}
