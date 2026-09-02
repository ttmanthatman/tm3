import type {
  ChainCreateConfigInput,
  ChainPayload,
  ChainSelectionInput
} from "../../shared/types.js";

export const CHAIN_OPTION_LIMIT = 10;
export const CHAIN_OPTION_LABEL_LIMIT = 20;
export const CHAIN_CUSTOM_TEXT_LIMIT = 40;

type ChainActor = { id: number; displayName: string };

export type ChainAppendResult =
  | { success: true; payload: ChainPayload }
  | { success: false; status: 400 | 409; message: string };

function compactSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeChainOptionLabels(values: string[]) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = compactSpaces(value);
    if (!label || [...label].length > CHAIN_OPTION_LABEL_LIMIT) continue;
    const key = label.toLocaleLowerCase();
    if (seen.has(key) || key === "其他") continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= CHAIN_OPTION_LIMIT) break;
  }
  return labels;
}

export function createChainPayload(topic: string, config?: ChainCreateConfigInput): ChainPayload {
  if (!config?.requiredSelection) return { topic, participants: [] };
  const labels = normalizeChainOptionLabels(config.options);
  if (!labels.length) return { topic, participants: [] };
  return {
    topic,
    schemaVersion: 2,
    participation: {
      mode: config.allowMultiple ? "required_multiple_choice" : "required_single_choice",
      options: labels.map((label, index) => ({ id: `option-${index + 1}`, label })),
      allowCustom: true
    },
    participants: []
  };
}

export function isRequiredChoiceChain(payload: ChainPayload) {
  return (payload.participation?.mode === "required_single_choice" || payload.participation?.mode === "required_multiple_choice")
    && Array.isArray(payload.participation.options)
    && payload.participation.options.length > 0;
}

export function appendChainParticipant(
  source: ChainPayload,
  actor: ChainActor,
  selection: ChainSelectionInput | undefined,
  at: string,
  legacyText = ""
): ChainAppendResult {
  const payload: ChainPayload = {
    ...source,
    participation: source.participation
      ? { ...source.participation, options: source.participation.options.map((option) => ({ ...option })) }
      : undefined,
    participants: Array.isArray(source.participants) ? source.participants.map((participant) => ({ ...participant })) : []
  };
  if (payload.participants.some((participant) => participant.actorId === actor.id)) {
    return { success: false, status: 409, message: "你已经参与过这个接龙" };
  }
  if (!isRequiredChoiceChain(payload)) {
    payload.participants.push({ actorId: actor.id, name: actor.displayName, text: legacyText, at });
    return { success: true, payload };
  }
  if (!selection) return { success: false, status: 400, message: "请选择具体项目后再参与接龙" };
  const allowsMultiple = payload.participation?.mode === "required_multiple_choice";
  if (selection.kind === "multiple") {
    if (!allowsMultiple) return { success: false, status: 400, message: "这个接龙只能选择一个项目" };
    const uniqueOptionIds = [...new Set(selection.optionIds)];
    if (uniqueOptionIds.length !== selection.optionIds.length) {
      return { success: false, status: 400, message: "所选接龙项目不能重复" };
    }
    const selectedOptions = uniqueOptionIds.map((optionId) => payload.participation?.options.find((item) => item.id === optionId));
    if (selectedOptions.some((option) => !option)) {
      return { success: false, status: 400, message: "所选接龙项目无效，请重新选择" };
    }
    const customText = compactSpaces(selection.customText || "");
    if ([...customText].length > CHAIN_CUSTOM_TEXT_LIMIT) {
      return { success: false, status: 400, message: `其他项目不能超过 ${CHAIN_CUSTOM_TEXT_LIMIT} 个字` };
    }
    if (!selectedOptions.length && !customText) {
      return { success: false, status: 400, message: "请至少选择一个具体项目" };
    }
    const storedOptions = selectedOptions.map((option) => ({ optionId: option!.id, label: option!.label }));
    const labels = storedOptions.map((option) => option.label);
    if (customText) labels.push(`其他：${customText}`);
    payload.participants.push({
      actorId: actor.id,
      name: actor.displayName,
      text: labels.join("、"),
      at,
      selection: {
        kind: "multiple",
        options: storedOptions,
        ...(customText ? { customLabel: customText } : {})
      }
    });
    return { success: true, payload };
  }
  if (allowsMultiple) {
    return { success: false, status: 400, message: "这个接龙可以多选，请重新选择项目" };
  }
  if (selection.kind === "option") {
    const option = payload.participation?.options.find((item) => item.id === selection.optionId);
    if (!option) return { success: false, status: 400, message: "所选接龙项目无效，请重新选择" };
    payload.participants.push({
      actorId: actor.id,
      name: actor.displayName,
      text: option.label,
      at,
      selection: { kind: "option", optionId: option.id, label: option.label }
    });
    return { success: true, payload };
  }
  const customText = compactSpaces(selection.text);
  if (!customText) return { success: false, status: 400, message: "请填写其他项目" };
  if ([...customText].length > CHAIN_CUSTOM_TEXT_LIMIT) {
    return { success: false, status: 400, message: `其他项目不能超过 ${CHAIN_CUSTOM_TEXT_LIMIT} 个字` };
  }
  payload.participants.push({
    actorId: actor.id,
    name: actor.displayName,
    text: `其他：${customText}`,
    at,
    selection: { kind: "custom", label: customText }
  });
  return { success: true, payload };
}
