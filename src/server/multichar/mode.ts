import type { PrismaClient } from "@prisma/client";
export const aiConversationSettingKey = (id: number) => `aiConversation.channel.${id}`;
export async function channelAiConversationEnabled(prisma: PrismaClient, channelId: number) {
  const row = await prisma.setting.findUnique({ where: { key: aiConversationSettingKey(channelId) } });
  if (!row) return false;
  try { return JSON.parse(row.value)?.enabled === true; } catch { return false; }
}
