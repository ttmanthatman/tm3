import type { ChainPayload, MessageDTO } from "../../../shared/types";

type ChainParticipant = ChainPayload["participants"][number];

export function chainPayload(message: MessageDTO): ChainPayload {
  const raw = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
    ? (message.payload as Partial<ChainPayload>)
    : {};
  return {
    topic: typeof raw.topic === "string" ? raw.topic : message.content || "接龙",
    schemaVersion: raw.schemaVersion === 2 ? 2 : undefined,
    participation: (raw.participation?.mode === "required_single_choice" || raw.participation?.mode === "required_multiple_choice")
      && Array.isArray(raw.participation.options)
      ? {
          mode: raw.participation.mode,
          options: raw.participation.options.filter((option) => !!option?.id && !!option?.label),
          allowCustom: true
        }
      : undefined,
    participants: Array.isArray(raw.participants) ? raw.participants : []
  };
}

export function chainRequiresSelection(message: MessageDTO) {
  const participation = chainPayload(message).participation;
  return !!participation && participation.options.length > 0;
}

export function chainParticipantProject(participant: ChainParticipant) {
  if (participant.selection?.kind === "option") return participant.selection.label;
  if (participant.selection?.kind === "custom") return `其他：${participant.selection.label}`;
  if (participant.selection?.kind === "multiple") {
    return [
      ...participant.selection.options.map((option) => option.label),
      ...(participant.selection.customLabel ? [`其他：${participant.selection.customLabel}`] : [])
    ].join("、");
  }
  return participant.text || "";
}
