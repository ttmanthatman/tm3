// 有声圣经提词器只在「仅聊天」界面出现：圣经工作区无论全屏还是与聊天分屏都不显示，
// 讲道/图书工作区占据聊天位时同样不显示；音乐歌词头可见时让位，避免两个顶端浮层叠影。
export type BibleAudioPromptVisibilityState = {
  sessionActive: boolean;
  bibleOpen: boolean;
  sermonWorkspaceOpen: boolean;
  bookWorkspaceOpen: boolean;
  musicLyricsHeaderVisible: boolean;
};

export function bibleAudioPromptVisible(state: BibleAudioPromptVisibilityState) {
  if (!state.sessionActive) return false;
  if (state.bibleOpen || state.sermonWorkspaceOpen || state.bookWorkspaceOpen) return false;
  return !state.musicLyricsHeaderVisible;
}
