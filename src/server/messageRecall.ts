export function recalledMessageData(senderName: string) {
  return {
    type: "system" as const,
    content: `${senderName} 撤回了一条消息`,
    payload: { recalled: true },
    fileName: null,
    filePath: null,
    fileSize: null,
    replyToId: null,
    chainRootId: null,
    chainVersion: null
  };
}
