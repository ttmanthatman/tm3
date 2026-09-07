import { createExclusiveAudio, type ExclusiveAudio } from "./exclusiveAudio";

// App.vue 与消息行内的音频播放器共享同一个互斥协调器：语音/音频消息播放时
// 渐弱暂停音乐与好友电台，消息播放自然结束后再渐强续播。
let sharedExclusiveAudio: ExclusiveAudio | null = null;

export function getSharedExclusiveAudio(): ExclusiveAudio {
  if (!sharedExclusiveAudio) sharedExclusiveAudio = createExclusiveAudio();
  return sharedExclusiveAudio;
}

// 每条消息的行内播放器各自持有 audio 元素；切换频道等场景需要统一停下所有
// 正在播放的消息音频，播放器挂载时在此登记停止回调。
const messageAudioStopHandlers = new Set<() => void>();

export function registerMessageAudioStop(handler: () => void): () => void {
  messageAudioStopHandlers.add(handler);
  return () => {
    messageAudioStopHandlers.delete(handler);
  };
}

export function stopAllMessageAudioPlayback() {
  for (const handler of [...messageAudioStopHandlers]) handler();
}
