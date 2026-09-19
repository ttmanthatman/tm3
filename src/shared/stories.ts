export type StoryGender = "female" | "male" | "unspecified";
export const STORY_DEFAULT_BIO = "小小的故事，大大的恩典";
export const STORY_BIO_MAX = 160;

export function storyGender(value?: string | null): StoryGender {
  return value === "female" || value === "male" ? value : "unspecified";
}

export const STORY_LIMITS = { images: 9, voices: 1, text: 2000, comment: 500, fileBytes: 10 * 1024 * 1024, voiceSeconds: 180 } as const;

export function storyTitle(gender?: string | null, own = false) {
  if (own) return "我的故事";
  return gender === "female" ? "她的故事" : gender === "male" ? "他的故事" : "TA的故事";
}

export function validStoryMedia(kinds: readonly string[]) {
  return kinds.length > 0 && kinds.every((kind) => kind === "image" || kind === "voice") &&
    kinds.filter((kind) => kind === "image").length <= STORY_LIMITS.images &&
    kinds.filter((kind) => kind === "voice").length <= STORY_LIMITS.voices;
}

export interface StoryAuthorDTO {
  accountId: number;
  actorId: number;
  displayName: string;
  avatarPath: string | null;
  gender: StoryGender;
  bio: string;
  own: boolean;
}

export interface StoryMediaDTO {
  id: number;
  kind: "image" | "voice";
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface StoryPersonDTO {
  accountId: number;
  actorId: number;
  displayName: string;
  avatarPath: string | null;
}

export interface StoryCommentDTO {
  id: number;
  author: StoryPersonDTO;
  text: string;
  createdAt: string;
  canDelete: boolean;
}

export interface StoryInteractionsDTO {
  liked: boolean;
  likeCount: number;
  likes: StoryPersonDTO[];
  commentCount: number;
  comments: StoryCommentDTO[];
}

export interface StoryDTO {
  id: number;
  text: string;
  createdAt: string;
  media: StoryMediaDTO[];
  interactions: StoryInteractionsDTO;
}

export interface StoryFeedItemDTO extends StoryDTO {
  author: StoryAuthorDTO;
}

export interface StoryPageDTO {
  author: StoryAuthorDTO;
  stories: StoryDTO[];
  nextCursor: number | null;
}

export interface StoryFeedPageDTO {
  viewer: StoryAuthorDTO;
  stories: StoryFeedItemDTO[];
  nextCursor: number | null;
}

export interface StoryNotificationDTO {
  id: string;
  kind: "like" | "comment";
  storyId: number;
  actor: StoryPersonDTO;
  text: string | null;
  createdAt: string;
}

export interface StoryActivityDTO {
  hasUnreadStories: boolean;
  notifications: StoryNotificationDTO[];
}
