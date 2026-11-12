export type ReminderUnit = "minutes" | "days";
export function reminderOffsets(text: string, unit: ReminderUnit): number[] {
  return text.split(/[,，]/).map(value => {
    if (!value.trim()) return NaN;
    const amount = Number(value.trim());
    return amount * (unit === "days" ? 1440 : 1);
  });
}
export function reminderEditor(offsets: number[]) {
  const unit: ReminderUnit = offsets.some(value => value > 0) && offsets.every(value => value % 1440 === 0) ? "days" : "minutes";
  return { unit, text: offsets.map(value => value / (unit === "days" ? 1440 : 1)).join(",") };
}
