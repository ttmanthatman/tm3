export interface ExclusiveAudioParticipant {
  id: string;
  /** false 的参与者（如语音消息）不会被自动续播 */
  resumable: boolean;
  /** 渐弱暂停，保留当前进度 */
  suspend(): void;
  /** 渐强续播 */
  resume(): void;
}

/**
 * 聊天室全局音频互斥协调器。
 * 用户当前选择播放的参与者拥有最高优先级：activate 时其他播放者渐弱暂停；
 * 当前播放自然结束（deactivate + resumeSuspended）后，最近被暂停的参与者渐强续播；
 * 用户手动暂停不触发续播。
 */
export function createExclusiveAudio() {
  const participants = new Map<string, ExclusiveAudioParticipant>();
  let activeId: string | null = null;
  const suspendedIds: string[] = [];

  function removeSuspended(id: string) {
    const index = suspendedIds.indexOf(id);
    if (index >= 0) suspendedIds.splice(index, 1);
  }

  function register(participant: ExclusiveAudioParticipant) {
    participants.set(participant.id, participant);
  }

  function unregister(id: string) {
    participants.delete(id);
    removeSuspended(id);
    if (activeId === id) activeId = null;
  }

  function activate(id: string) {
    if (!participants.has(id)) return;
    const previousId = activeId;
    activeId = id;
    removeSuspended(id);
    if (!previousId || previousId === id) return;
    const previous = participants.get(previousId);
    if (!previous) return;
    previous.suspend();
    if (previous.resumable && !suspendedIds.includes(previousId)) suspendedIds.push(previousId);
  }

  function deactivate(id: string, options: { resumeSuspended?: boolean } = {}) {
    removeSuspended(id);
    if (activeId !== id) return;
    activeId = null;
    if (!options.resumeSuspended) return;
    const nextId = suspendedIds.pop();
    if (!nextId) return;
    const next = participants.get(nextId);
    if (!next) return;
    activeId = nextId;
    next.resume();
  }

  return {
    register,
    unregister,
    activate,
    deactivate,
    isActive: (id: string) => activeId === id,
    isSuspended: (id: string) => suspendedIds.includes(id),
    activeId: () => activeId
  };
}

export type ExclusiveAudio = ReturnType<typeof createExclusiveAudio>;
