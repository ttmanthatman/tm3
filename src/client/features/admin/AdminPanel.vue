<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import type { Component, ComputedRef, Ref } from "vue";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  DoorOpen,
  Download,
  Image as ImageIcon,
  Info,
  Library,
  Menu,
  MessageCircle,
  MessageSquareQuote,
  Monitor,
  Palette,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X
} from "lucide-vue-next";
import type { ChannelDTO, ThemeDTO, UpdateCheckDTO, UpdateStatusDTO, VersionDTO } from "@shared/types";
import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES } from "@shared/release";
import { MUSIC_PANEL_FONT_SIZE_MAX, MUSIC_PANEL_FONT_SIZE_MIN, cleanMusicPanelFontSize } from "@shared/musicPlayback";
import { cleanWallpaperPanSpeed } from "@shared/wallpaperPan";
import { compactBytes } from "../../time";
import { cleanParallaxSpeed, parallaxAssetUrl } from "../../parallax";
import ParallaxBackground from "../../components/ParallaxBackground.vue";
import { useChatStore } from "../../store";
import { adminDirectPageSize, type AdminTools } from "./useAdminTools";
import { loginBackgroundFitOptions, loginPositionOptions, primaryColorFields, wallpaperFitOptions } from "./useAppearanceSettings";

const AdminResourceManager = defineAsyncComponent(() => import("../../components/AdminResourceManager.vue"));
const AdminAccountsPage = defineAsyncComponent(() => import("./AdminAccountsPage.vue"));
const AdminBooksPage = defineAsyncComponent(() => import("./AdminBooksPage.vue"));
const AdminReceptionPage = defineAsyncComponent(() => import("./AdminReceptionPage.vue"));
const WeChatRelayPanel = defineAsyncComponent(() => import("./WeChatRelayPanel.vue"));
const DemoModePanel = defineAsyncComponent(() => import("./DemoModePanel.vue"));

interface AdminReleaseBindings {
  serverVersion: Ref<VersionDTO | null>;
  updateCheck: Ref<UpdateCheckDTO | null>;
  updateStatus: Ref<UpdateStatusDTO | null>;
  updateBusy: Ref<boolean>;
  selectedUpdateBranch: Ref<string>;
  updateProgress: ComputedRef<number>;
  updateStateText: ComputedRef<string>;
  updateRestartModeLabel: ComputedRef<string>;
  updateStartDisabled: ComputedRef<boolean>;
  checkForUpdates: () => Promise<void>;
  startServerUpdate: () => Promise<void>;
  releaseHistory: Ref<Array<{ version: string; date: string; notes: readonly string[] }>>;
  releaseDeveloper: ComputedRef<string>;
}

interface AdminPanelActions {
  startMessageSelectionMode: () => Promise<void>;
  openAdminChannelMembers: (channel: ChannelDTO) => Promise<void>;
  channelIconUrl: (channel?: Pick<ChannelDTO, "icon"> | null) => string;
  wallpaperUrl: (path?: string | null) => string;
  themeSwatchStyle: (theme: ThemeDTO) => { background: string };
}

const props = defineProps<{
  tools: AdminTools;
  release: AdminReleaseBindings;
  actions: AdminPanelActions;
}>();

const store = useChatStore();

const {
  adminPage,
  adminPageLoading,
  adminPageError,
  adminMsg,
  noticeText,
  adminChannelRows,
  adminDirectConversations,
  adminDirectTotal,
  adminDirectPage,
  adminDirectQuery,
  adminDirectPageCount,
  adminSelectedChannel,
  channelEdits,
  adminAttachments,
  adminAttachmentsLoading,
  adminAttachmentsError,
  adminBackups,
  adminBackupBusy,
  dataChannelFilter,
  adminAppearancePages,
  activeAdminPageMeta,
  appearanceSection,
  appearancePreviewOpen,
  appearanceThemeAdvancedOpen,
  loginAppearanceEdit,
  flashEffectEdit,
  composerPromptsText,
  composerPromptIntervalEdit,
  composerPromptAppearEdit,
  composerPromptDisappearEdit,
  composerPromptGapEdit,
  customThemeEdit,
  parallaxLayerInput,
  parallaxLayerUploadBusy,
  activeAppearanceSection,
  appearanceDraftIcon,
  appearanceDraftLoginIcon,
  appearanceDraftWallpaper,
  appearancePreviewLoginStyle,
  appearancePreviewChatStyle,
  wallpaperPanFocusMarkerStyle,
  wallpaperPanSpeedLabel,
  parallaxKitOptions,
  draftParallaxKit,
  parallaxSpeedLabel,
  appearancePreviewFlashStyle,
  appearanceThemePreviewStyle,
  appearanceThemeOptions,
  customThemeDraftIds,
  appearanceAdvancedColorFields,
  appearanceHasDraftChanges,
  saveNotice,
  openAdminPage,
  openAdminChannelDetail,
  returnFromAdminPage,
  searchDirectConversations,
  changeDirectConversationPage,
  loadAdminAttachments,
  loadAdminBackups,
  clearAdminMessages,
  deleteAdminAttachments,
  deleteAllAdminAttachments,
  createAdminBackup,
  deleteAdminBackup,
  compressAdminAttachments,
  downloadAdminFile,
  importAdminFile,
  closeAdminPanel,
  updateChannel,
  uploadChannelIcon,
  deleteChannel,
  deleteDirectConversation,
  adminDateTime,
  directConversationLabel,
  directConversationActivity,
  openAppearanceImagePicker,
  createParallaxKit,
  deleteParallaxKit,
  restoreBuiltInParallaxKit,
  moveParallaxLayer,
  removeParallaxLayer,
  pickParallaxLayer,
  uploadParallaxLayer,
  setWallpaperPanFocus,
  addFlashColor,
  removeFlashColor,
  saveLoginAppearance,
  editTheme,
  resetThemeEditor,
  saveCustomTheme,
  deleteCustomTheme
} = props.tools;

const {
  serverVersion,
  updateCheck,
  updateStatus,
  updateBusy,
  selectedUpdateBranch,
  updateProgress,
  updateStateText,
  updateRestartModeLabel,
  updateStartDisabled,
  checkForUpdates,
  startServerUpdate,
  releaseHistory,
  releaseDeveloper
} = props.release;

const { startMessageSelectionMode, openAdminChannelMembers, channelIconUrl, wallpaperUrl, themeSwatchStyle } = props.actions;
</script>

<template>
    <section class="modal-shell" role="dialog" aria-modal="true" aria-label="管理面板" @click.self="closeAdminPanel">
      <div class="admin-modal">
        <header class="modal-head admin-page-head">
          <button v-if="adminPage !== 'home'" class="icon-btn" @click="returnFromAdminPage" aria-label="返回上一级"><ChevronLeft :size="21" /></button>
          <div class="admin-page-heading">
            <strong>{{ activeAdminPageMeta.title }}</strong>
            <small>{{ activeAdminPageMeta.description }}</small>
          </div>
          <button class="icon-btn" @click="closeAdminPanel" aria-label="关闭管理"><X :size="20" /></button>
        </header>

        <div class="admin-body">
          <div v-if="adminPageLoading" class="admin-page-state" role="status"><span class="loading-dot"></span>正在加载...</div>
          <div v-else-if="adminPageError" class="admin-page-state error" role="alert">
            <CircleOff :size="20" />
            <span>{{ adminPageError }}</span>
            <button class="mini-btn secondary" @click="openAdminPage(adminPage)">重试</button>
          </div>

          <section v-else-if="adminPage === 'home'" class="admin-hub">
            <div class="admin-hub-intro">
              <strong>管理聊天室</strong>
              <small>选择一个功能进入独立页面；返回时会回到这一层。</small>
            </div>
            <div class="admin-hub-group">
              <label>内容与成员</label>
              <button class="admin-entry-row" @click="openAdminPage('pin')"><span class="admin-entry-icon"><Pin :size="20" /></span><span><b>置顶公告</b><small>管理当前频道的顶部公告</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('users')"><span class="admin-entry-icon"><Users :size="20" /></span><span><b>用户与权限</b><small>账号、头像、密码和管理权限</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('channels')"><span class="admin-entry-icon"><Menu :size="20" /></span><span><b>频道与私聊历史</b><small>正式频道和历史会话分开管理</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('reception')"><span class="admin-entry-icon"><DoorOpen :size="20" /></span><span><b>会客厅</b><small>创建者、期限、人数和用量</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('books')"><span class="admin-entry-icon"><Library :size="20" /></span><span><b>图书</b><small>上传 EPUB 图书，管理图书室藏书</small></span><ChevronRight :size="19" /></button>
            </div>
            <div class="admin-hub-group">
              <label>通知与连接</label>
              <button class="admin-entry-row" @click="openAdminPage('wechatRelay')"><span class="admin-entry-icon"><Bell :size="20" /></span><span><b>微信通知转发</b><small>连接 NAS 微信并向指定群发送频道通知</small></span><ChevronRight :size="19" /></button>
            </div>
            <div class="admin-hub-group">
              <label>外观与数据</label>
              <button class="admin-entry-row" @click="openAdminPage('appearance')"><span class="admin-entry-icon"><Palette :size="20" /></span><span><b>外观与体验</b><small>品牌、登录页、聊天室和主题</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('data')"><span class="admin-entry-icon"><Download :size="20" /></span><span><b>数据与系统</b><small>备份、消息和资源管理</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('release')"><span class="admin-entry-icon"><Info :size="20" /></span><span><b>版本与更新</b><small>版本状态和发布记录</small></span><ChevronRight :size="19" /></button>
            </div>
          </section>

          <section v-else-if="adminPage === 'appearance'" class="admin-hub compact">
            <div class="admin-hub-group">
              <button class="admin-entry-row" @click="openAdminPage('appearanceBrand')"><span class="admin-entry-icon"><Info :size="20" /></span><span><b>品牌与标签页</b><small>浏览器标题、图标和应用入口</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('appearanceLogin')"><span class="admin-entry-icon"><Monitor :size="20" /></span><span><b>登录页</b><small>内容、背景、位置和注册入口</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('appearanceChat')"><span class="admin-entry-icon"><MessageCircle :size="20" /></span><span><b>聊天室外观</b><small>聊天区壁纸和显示方式</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('appearanceParallax')"><span class="admin-entry-icon"><ImageIcon :size="20" /></span><span><b>卷轴背景</b><small>多层景色和阅读联动速度</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('appearanceThemes')"><span class="admin-entry-icon"><Palette :size="20" /></span><span><b>主题颜色</b><small>创建和维护聊天室配色</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('appearanceFlash')"><span class="admin-entry-icon"><Sparkles :size="20" /></span><span><b>消息闪动特效</b><small>颜色、过渡方式和闪动节奏</small></span><ChevronRight :size="19" /></button>
            </div>
          </section>

          <section v-else-if="adminPage === 'data'" class="admin-hub compact">
            <div class="admin-hub-group">
              <button class="admin-entry-row" @click="openAdminPage('backups')"><span class="admin-entry-icon"><Download :size="20" /></span><span><b>备份与迁移</b><small>完整备份及数据导入导出</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('messages')"><span class="admin-entry-icon"><MessageSquareQuote :size="20" /></span><span><b>聊天记录</b><small>选择消息或按频道清理</small></span><ChevronRight :size="19" /></button>
              <button class="admin-entry-row" @click="openAdminPage('resources')"><span class="admin-entry-icon"><ImageIcon :size="20" /></span><span><b>资源管理</b><small>查看、压缩和删除附件</small></span><ChevronRight :size="19" /></button>
              <button v-if="serverVersion?.demo?.available" class="admin-entry-row" @click="openAdminPage('demo')"><span class="admin-entry-icon"><RotateCcw :size="20" /></span><span><b>演示模式</b><small>从 GitHub 载入或复位标准演示数据</small></span><ChevronRight :size="19" /></button>
            </div>
          </section>

          <section v-else-if="adminPage === 'pin'" class="form-grid admin-page-section">
            <label>当前频道置顶公告</label>
            <textarea v-model="noticeText" rows="4" placeholder="留空并保存可撤下置顶公告"></textarea>
            <button class="primary-btn" @click="saveNotice">保存置顶</button>
          </section>

          <AdminAccountsPage v-else-if="adminPage === 'users'" @message="adminMsg = $event" />

          <AdminReceptionPage v-else-if="adminPage === 'reception'" />

          <section v-else-if="adminPage === 'channels'" class="admin-page-section channel-history-page">
            <div class="admin-section-heading">
              <div><strong>正式频道</strong><small>公开和私密频道；点击进入详情页编辑。</small></div>
              <span>{{ adminChannelRows.length }} 个</span>
            </div>
            <div class="admin-object-list">
              <button v-for="channel in adminChannelRows" :key="channel.id" class="admin-object-row" @click="openAdminChannelDetail(channel)">
                <span class="channel-icon-admin"><span v-if="channel.kind === 'music'" class="channel-icon-glyph" aria-hidden="true">歌</span><img v-else :src="channelIconUrl(channel)" alt="" /></span>
                <span class="admin-object-main"><b>{{ channel.name }}</b><small>{{ channel.isPrivate ? '私密频道' : '公开频道' }} · {{ channel.memberCount }} 人 · {{ channel.messageCount }} 条消息</small></span>
                <span v-if="channel.isDefault" class="admin-status-pill">默认</span>
                <ChevronRight :size="19" />
              </button>
              <p v-if="!adminChannelRows.length" class="empty-note">还没有正式频道</p>
            </div>

            <div class="admin-section-heading direct-history-heading">
              <div><strong>私聊历史</strong><small>保留的历史会话不再作为频道；可在这里查找和永久删除。</small></div>
              <span>{{ adminDirectTotal }} 个</span>
            </div>
            <form class="admin-search-row" @submit.prevent="searchDirectConversations">
              <input v-model="adminDirectQuery" maxlength="80" placeholder="搜索私聊参与者" aria-label="搜索私聊历史" />
              <button class="mini-btn secondary" type="submit">搜索</button>
            </form>
            <div class="admin-object-list direct-history-list">
              <article v-for="conversation in adminDirectConversations" :key="conversation.id" class="admin-object-row direct-history-row">
                <span class="admin-entry-icon"><Archive :size="20" /></span>
                <span class="admin-object-main">
                  <b>{{ directConversationLabel(conversation) }}</b>
                  <small>{{ conversation.messageCount }} 条消息 · {{ conversation.memberCount }} 位参与者 · 最后活动 {{ directConversationActivity(conversation) }}</small>
                </span>
                <button class="mini-btn danger-action" @click="deleteDirectConversation(conversation)"><Trash2 :size="15" />删除历史</button>
              </article>
              <p v-if="!adminDirectConversations.length" class="empty-note">{{ adminDirectQuery ? '没有匹配的私聊历史' : '还没有私聊历史' }}</p>
            </div>
            <div v-if="adminDirectTotal > adminDirectPageSize" class="admin-pagination">
              <button class="mini-btn secondary" :disabled="adminDirectPage <= 1" @click="changeDirectConversationPage(-1)">上一页</button>
              <span>第 {{ adminDirectPage }} / {{ adminDirectPageCount }} 页</span>
              <button class="mini-btn secondary" :disabled="adminDirectPage >= adminDirectPageCount" @click="changeDirectConversationPage(1)">下一页</button>
            </div>
          </section>

          <section v-else-if="adminPage === 'channelDetail' && adminSelectedChannel && channelEdits[adminSelectedChannel.id]" class="form-grid admin-page-section channel-detail-page">
            <label>频道图标</label>
            <label class="channel-detail-icon" :class="{ 'upload-icon-trigger': adminSelectedChannel.kind !== 'music' }" :aria-label="adminSelectedChannel.kind === 'music' ? '音乐频道系统图标' : `上传 ${adminSelectedChannel.name} 的频道图标`" :title="adminSelectedChannel.kind === 'music' ? '系统频道' : '点击上传图标'">
              <span v-if="adminSelectedChannel?.kind === 'music'" class="channel-icon-glyph" aria-hidden="true">歌</span>
              <img v-else :src="channelIconUrl(adminSelectedChannel)" alt="" />
              <span>{{ adminSelectedChannel.kind === "music" ? "系统频道" : "点击更换图标" }}</span>
              <input v-if="adminSelectedChannel.kind !== 'music'" class="hidden" type="file" accept="image/*" @change="uploadChannelIcon(adminSelectedChannel, $event)" />
            </label>
            <label for="admin-channel-name">频道名称</label>
            <input id="admin-channel-name" v-model="channelEdits[adminSelectedChannel.id].name" maxlength="80" :disabled="adminSelectedChannel.kind === 'music'" />
            <label for="admin-channel-description">频道描述</label>
            <textarea id="admin-channel-description" v-model="channelEdits[adminSelectedChannel.id].description" maxlength="255" rows="3" :disabled="adminSelectedChannel.kind === 'music'"></textarea>
            <label class="check-row check-row-inline">
              <input v-model="channelEdits[adminSelectedChannel.id].useListColor" type="checkbox" />
              <span>自定义频道列表底色</span>
            </label>
            <label v-if="channelEdits[adminSelectedChannel.id].useListColor" class="channel-list-color-field">
              <span>列表底色</span>
              <input v-model="channelEdits[adminSelectedChannel.id].listColor" type="color" aria-label="频道列表底色" />
              <code>{{ channelEdits[adminSelectedChannel.id].listColor }}</code>
            </label>
            <div class="channel-detail-summary">
              <span>{{ adminSelectedChannel.isPrivate ? '私密频道' : '公开频道' }}</span>
              <span>{{ adminSelectedChannel.memberCount }} 位成员</span>
              <span>{{ adminSelectedChannel.messageCount }} 条消息</span>
            </div>
            <div class="channel-detail-actions">
              <button class="primary-btn" @click="updateChannel(adminSelectedChannel)"><Save :size="15" />保存修改</button>
              <button v-if="adminSelectedChannel.kind !== 'music'" class="mini-btn secondary" @click="openAdminChannelMembers(adminSelectedChannel)"><Users :size="15" />管理成员</button>
              <button v-if="adminSelectedChannel.kind !== 'music' && !adminSelectedChannel.isDefault" class="mini-btn danger-action" @click="deleteChannel(adminSelectedChannel)"><Trash2 :size="15" />删除频道</button>
            </div>
            <p v-if="adminSelectedChannel.kind === 'music'" class="settings-note">音乐频道的名称和图标由系统维护；列表底色仍可自定义。</p>
          </section>

          <section v-else-if="adminAppearancePages.has(adminPage)" class="appearance-admin-layout">
            <div class="appearance-save-bar">
              <div>
                <b>外观草稿</b>
                <small>{{ appearanceHasDraftChanges ? "有未保存更改，保存后才会对聊天室生效。" : "所有外观设置都已保存。" }}</small>
              </div>
              <div class="appearance-save-actions">
                <button class="mini-btn secondary appearance-mobile-preview-btn" @click="appearancePreviewOpen = true">预览</button>
                <button class="primary-btn" :class="{ attention: appearanceHasDraftChanges }" @click="saveLoginAppearance"><Save :size="15" />保存外观</button>
              </div>
            </div>

            <div class="appearance-editor-panel form-grid">
              <template v-if="appearanceSection === 'brand'">
                <label class="inline-field-row">
                  <span>浏览器标签页</span>
                  <input v-model="loginAppearanceEdit.appTitle" maxlength="80" placeholder="浏览器标签页标题" aria-label="浏览器标签页标题" />
                </label>
                <div class="appearance-image-control">
                  <button class="appearance-image-preview-button login-icon-preview" @click="openAppearanceImagePicker('appIconPath', '选择标签页图标', '适合方形或接近方形的小图。')" aria-label="选择标签页图标">
                    <img :src="appearanceDraftIcon" alt="" />
                  </button>
                  <div>
                    <strong>标签页图标</strong>
                    <small>点击图标选择图片；用于浏览器标签、收藏夹和应用入口。</small>
                  </div>
                </div>
              </template>

              <template v-else-if="appearanceSection === 'login'">
                <label>登录页内容</label>
                <div class="login-brand-grid">
                  <input v-model="loginAppearanceEdit.loginTitle" maxlength="80" placeholder="登录页标题" aria-label="登录页标题" />
                  <input v-model="loginAppearanceEdit.loginSubtitle" maxlength="160" placeholder="登录页副标题" aria-label="登录页副标题" />
                </div>
                <div class="check-grid login-visibility-options">
                  <label class="check-row"><input v-model="loginAppearanceEdit.loginShowIcon" type="checkbox" /> 显示登录页图标</label>
                  <label class="check-row"><input v-model="loginAppearanceEdit.loginShowSubtitle" type="checkbox" /> 显示登录页副标题</label>
                </div>

                <label>登录区域位置</label>
                <div class="segmented-row login-position-options">
                  <button
                    v-for="option in loginPositionOptions"
                    :key="option.value"
                    class="mini-btn"
                    :class="{ secondary: loginAppearanceEdit.loginFormPosition !== option.value }"
                    @click="loginAppearanceEdit.loginFormPosition = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>

                <label>登录页图标与背景</label>
                <div class="appearance-image-stack">
                  <div class="appearance-image-control">
                    <button class="appearance-image-preview-button login-icon-preview" @click="openAppearanceImagePicker('loginIconPath', '选择登录页图标', '登录卡片中的品牌图标，建议方形图片。')" aria-label="选择登录页图标">
                      <img :src="appearanceDraftLoginIcon" alt="" />
                    </button>
                    <div>
                      <strong>登录页图标</strong>
                      <small>{{ loginAppearanceEdit.loginIconPath || "使用默认图标，点击图标更换" }}</small>
                    </div>
                  </div>
                  <div class="appearance-image-control">
                    <button class="appearance-image-preview-button login-background-preview" :style="appearancePreviewLoginStyle" @click="openAppearanceImagePicker('loginBackgroundPath', '选择登录页背景', '适合横向或竖向大图，可在这里设置显示方式。', 'loginBackgroundFit')" aria-label="选择登录页背景"></button>
                    <div>
                      <strong>登录页背景</strong>
                      <small>{{ loginAppearanceEdit.loginBackgroundPath || "未设置背景图，点击预览更换" }}</small>
                    </div>
                    <select v-model="loginAppearanceEdit.loginBackgroundFit" aria-label="登录页背景显示方式">
                      <option v-for="option in loginBackgroundFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                </div>

                <label>登录入口</label>
                <label class="check-row"><input v-model="loginAppearanceEdit.registrationEnabled" type="checkbox" /> 开放注册</label>
              </template>

              <template v-else-if="appearanceSection === 'chat'">
                <label>聊天室壁纸</label>
                <div class="appearance-image-control">
                  <button class="appearance-image-preview-button login-background-preview chat" :style="appearancePreviewChatStyle" @click="openAppearanceImagePicker('wallpaperPath', '选择聊天室壁纸', '聊天消息后方的背景图，可选择填满、完整显示、拉伸、平铺或推拉摇移。', 'wallpaperFit')" aria-label="选择聊天室壁纸"></button>
                  <div>
                    <strong>聊天区背景图</strong>
                    <small>{{ loginAppearanceEdit.wallpaperPath || "未设置壁纸，点击预览更换" }}</small>
                  </div>
                  <select v-model="loginAppearanceEdit.wallpaperFit" aria-label="聊天室壁纸显示方式">
                    <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
                <section v-if="loginAppearanceEdit.wallpaperFit === 'pan'" class="wallpaper-pan-settings">
                  <div>
                    <b>初始画面中心</b>
                    <small>在图上点选一个位置；打开聊天室时，该横坐标会尽量对准视口中心。</small>
                  </div>
                  <button
                    v-if="appearanceDraftWallpaper"
                    type="button"
                    class="wallpaper-pan-focus-picker"
                    @click="setWallpaperPanFocus"
                    aria-label="在壁纸上指定初始画面中心"
                  >
                    <span class="wallpaper-pan-focus-image">
                      <img :src="wallpaperUrl(appearanceDraftWallpaper)" alt="" />
                      <span class="wallpaper-pan-focus-line" :style="wallpaperPanFocusMarkerStyle"><i></i></span>
                    </span>
                  </button>
                  <p v-else class="settings-note">请先选择一张聊天室壁纸。</p>
                  <div class="wallpaper-pan-controls">
                    <label>
                      <span>初始移动方向</span>
                      <span class="segmented-buttons">
                        <button type="button" :class="{ selected: loginAppearanceEdit.wallpaperPanDirection === 'left' }" @click="loginAppearanceEdit.wallpaperPanDirection = 'left'">向左</button>
                        <button type="button" :class="{ selected: loginAppearanceEdit.wallpaperPanDirection === 'right' }" @click="loginAppearanceEdit.wallpaperPanDirection = 'right'">向右</button>
                      </span>
                    </label>
                    <label>
                      <span><b>相对消息移动速度</b><output>{{ wallpaperPanSpeedLabel }}</output></span>
                      <input v-model.number="loginAppearanceEdit.wallpaperPanSpeed" type="range" min="0.02" max="1" step="0.01" />
                      <small>消息上下移动 100 像素时，壁纸移动 {{ Math.round(cleanWallpaperPanSpeed(loginAppearanceEdit.wallpaperPanSpeed) * 100) }} 像素。</small>
                    </label>
                  </div>
                </section>
                <label>音乐小窗</label>
                <div class="wallpaper-pan-controls">
                  <label>
                    <span><b>「歌」小窗字号</b><output>{{ cleanMusicPanelFontSize(loginAppearanceEdit.musicPanelFontSize) }}px</output></span>
                    <input v-model.number="loginAppearanceEdit.musicPanelFontSize" type="range" :min="MUSIC_PANEL_FONT_SIZE_MIN" :max="MUSIC_PANEL_FONT_SIZE_MAX" step="1" />
                    <small>调整点击「歌」弹出的播放小窗文字大小，对所有成员生效。</small>
                  </label>
                </div>
                <label>代祷卡片</label>
                <div class="color-grid">
                  <label class="color-row">
                    <span>自己的代祷卡片</span>
                    <input v-model="loginAppearanceEdit.prayerBubbleMineColor" type="color" />
                    <code>{{ loginAppearanceEdit.prayerBubbleMineColor }}</code>
                  </label>
                  <label class="color-row">
                    <span>别人的代祷卡片</span>
                    <input v-model="loginAppearanceEdit.prayerBubbleOtherColor" type="color" />
                    <code>{{ loginAppearanceEdit.prayerBubbleOtherColor }}</code>
                  </label>
                </div>
                <small>建议选择浅色，保存后对所有成员即时生效。</small>
                <label>输入框引导语</label>
                <div class="composer-prompt-settings">
                  <textarea v-model="composerPromptsText" rows="4" placeholder="一行一条，例如：分享下今天的恩典？"></textarea>
                  <small>输入框空闲时轮播这些引导语，文字逐字显现、逐字熄灭；有人 @ 成员时立即提醒「回应一下」。清空列表可关闭轮播。</small>
                  <label class="flash-interval-row">
                    <span>显示时长（秒）</span>
                    <input v-model.number="composerPromptIntervalEdit" type="number" min="1" max="30" step="0.5" />
                  </label>
                  <label class="flash-interval-row">
                    <span>出现动画（秒）</span>
                    <input v-model.number="composerPromptAppearEdit" type="number" min="0.3" max="5" step="0.1" />
                  </label>
                  <label class="flash-interval-row">
                    <span>消失动画（秒）</span>
                    <input v-model.number="composerPromptDisappearEdit" type="number" min="0.3" max="5" step="0.1" />
                  </label>
                  <label class="flash-interval-row">
                    <span>间隔时间（秒）</span>
                    <input v-model.number="composerPromptGapEdit" type="number" min="1" max="60" step="1" />
                  </label>
                </div>
              </template>

              <template v-else-if="appearanceSection === 'parallax'">
                <div class="parallax-section-heading">
                  <div><b>卷轴套件</b><small>选择现有套件，或创建套件后逐层上传透明 PNG。</small></div>
                  <button type="button" class="mini-btn secondary" @click="createParallaxKit"><Plus :size="14" />新建套件</button>
                </div>
                <div class="parallax-kit-grid">
                  <button
                    type="button"
                    class="parallax-kit-card"
                    :class="{ selected: loginAppearanceEdit.parallaxKit === 'none' }"
                    @click="loginAppearanceEdit.parallaxKit = 'none'"
                  >
                    <span class="parallax-off-preview">关闭</span>
                    <strong>不使用卷轴</strong>
                    <small>继续显示聊天室壁纸或主题背景。</small>
                  </button>
                  <button
                    v-for="kit in parallaxKitOptions"
                    :key="kit.id"
                    type="button"
                    class="parallax-kit-card"
                    :class="{ selected: loginAppearanceEdit.parallaxKit === kit.id }"
                    @click="loginAppearanceEdit.parallaxKit = kit.id"
                  >
                    <span class="parallax-kit-thumbnail"><ParallaxBackground :kit="kit" :offset="34" preview /></span>
                    <strong>{{ kit.name }}</strong>
                    <small>{{ kit.description }}</small>
                  </button>
                </div>
                <section v-if="draftParallaxKit" class="parallax-kit-editor">
                  <header>
                    <div>
                      <b>套件设置</b>
                      <small>{{ draftParallaxKit.layers.length }} 层 · 下方顺序为从后到前</small>
                    </div>
                    <button v-if="draftParallaxKit.builtIn" type="button" class="mini-btn secondary" @click="restoreBuiltInParallaxKit"><RotateCcw :size="14" />恢复官方设置</button>
                    <button v-else type="button" class="mini-btn danger-action" @click="deleteParallaxKit(draftParallaxKit)"><Trash2 :size="14" />删除套件</button>
                  </header>
                  <div class="parallax-kit-fields">
                    <label><span>套件名称</span><input v-model="draftParallaxKit.name" maxlength="40" /></label>
                    <label><span>说明</span><input v-model="draftParallaxKit.description" maxlength="120" /></label>
                    <label><span>素材署名</span><input v-model="draftParallaxKit.credit" maxlength="120" placeholder="可选" /></label>
                  </div>
                  <div class="parallax-layer-toolbar">
                    <div><b>图层</b><small>速度 0 为固定；上下位置单位为像素；画布高度 1.00× 通常适合等尺寸图层。</small></div>
                    <button type="button" class="mini-btn secondary" :disabled="parallaxLayerUploadBusy" @click="pickParallaxLayer"><Upload :size="14" />{{ parallaxLayerUploadBusy ? "上传中…" : "上传图层" }}</button>
                    <input ref="parallaxLayerInput" class="hidden" type="file" accept="image/*" @change="uploadParallaxLayer" />
                  </div>
                  <div v-if="draftParallaxKit.layers.length" class="parallax-layer-list">
                    <article v-for="(layer, index) in draftParallaxKit.layers" :key="layer.id" class="parallax-layer-row" :data-layer-id="layer.id">
                      <div class="parallax-layer-thumb" :style="{ backgroundImage: `url(${parallaxAssetUrl(draftParallaxKit.id, layer.file)})` }"></div>
                      <div class="parallax-layer-main">
                        <label><span>{{ index + 1 }} · {{ index === 0 ? "最远" : index === draftParallaxKit.layers.length - 1 ? "最前" : "中间" }}</span><input v-model="layer.name" maxlength="40" /></label>
                        <div class="parallax-layer-values">
                          <label><span>速度比</span><input v-model.number="layer.speed" type="number" min="0" max="3" step="0.01" /></label>
                          <label><span>上下位置</span><input v-model.number="layer.yOffset" type="number" min="-600" max="600" step="1" /><em>px</em></label>
                          <label><span>画布高度</span><input v-model.number="layer.heightScale" type="number" min="0.25" max="4" step="0.05" /><em>×</em></label>
                        </div>
                      </div>
                      <div class="parallax-layer-actions">
                        <button type="button" class="icon-btn" :disabled="index === 0" title="向后移动" @click="moveParallaxLayer(index, -1)"><ArrowUp :size="15" /></button>
                        <button type="button" class="icon-btn" :disabled="index === draftParallaxKit.layers.length - 1" title="向前移动" @click="moveParallaxLayer(index, 1)"><ArrowDown :size="15" /></button>
                        <button type="button" class="icon-btn danger-action" title="移除图层" @click="removeParallaxLayer(index)"><Trash2 :size="15" /></button>
                      </div>
                    </article>
                  </div>
                  <p v-else class="parallax-empty-layers">还没有图层。上传的第一张图会作为最远背景，后续图层依次放在它前面。</p>
                </section>
                <label class="parallax-speed-field">
                  <span><b>相对移动速度</b><output>{{ parallaxSpeedLabel }}</output></span>
                  <input v-model.number="loginAppearanceEdit.parallaxSpeed" type="range" min="0.25" max="3" step="0.05" :disabled="loginAppearanceEdit.parallaxKit === 'none'" />
                  <small>1.00× 为推荐速度；向上查看历史时景色向左，向下阅读及新消息跟随时向右。</small>
                </label>
                <p v-if="draftParallaxKit?.credit" class="parallax-credit">素材：{{ draftParallaxKit.credit }}</p>
              </template>

              <template v-else-if="appearanceSection === 'themes'">
                <label>主题编辑</label>
                <div class="theme-editor-head">
                  <input v-model="customThemeEdit.name" maxlength="24" placeholder="主题名称" />
                  <button class="mini-btn secondary" @click="resetThemeEditor">用当前主题填充</button>
                </div>
                <div class="color-grid">
                  <label v-for="field in primaryColorFields" :key="field.key" class="color-row">
                    <span>{{ field.label }}</span>
                    <input v-model="customThemeEdit.palette[field.key]" type="color" />
                    <code>{{ customThemeEdit.palette[field.key] }}</code>
                  </label>
                </div>
                <button class="mini-btn secondary" @click="appearanceThemeAdvancedOpen = !appearanceThemeAdvancedOpen">{{ appearanceThemeAdvancedOpen ? "收起更多颜色" : "更多颜色" }}</button>
                <div v-if="appearanceThemeAdvancedOpen" class="color-grid">
                  <label v-for="field in appearanceAdvancedColorFields" :key="field.key" class="color-row">
                    <span>{{ field.label }}</span>
                    <input v-model="customThemeEdit.palette[field.key]" type="color" />
                    <code>{{ customThemeEdit.palette[field.key] }}</code>
                  </label>
                </div>
                <button class="primary-btn" @click="saveCustomTheme"><Save :size="15" />加入 / 更新主题草稿</button>

                <label>可选主题</label>
                <div class="theme-admin-list">
                  <article v-for="theme in appearanceThemeOptions" :key="theme.id" class="theme-admin-row">
                    <span class="theme-admin-swatch" :style="themeSwatchStyle(theme)"></span>
                    <b>{{ theme.name }}</b>
                    <small>{{ customThemeDraftIds.has(theme.id) ? "自定义" : "内置" }}</small>
                    <button class="mini-btn secondary" @click="editTheme(theme)">编辑</button>
                    <button v-if="customThemeDraftIds.has(theme.id)" class="mini-btn danger-action" @click="deleteCustomTheme(theme)"><Trash2 :size="14" />删除</button>
                  </article>
                </div>
              </template>

              <template v-else>
                <label>闪动节奏</label>
                <div class="flash-effect-editor">
                  <label class="flash-interval-row">
                    <span>闪动间隔（秒）</span>
                    <input v-model.number="flashEffectEdit.intervalSeconds" type="number" min="0.01" max="10" step="0.01" />
                  </label>
                  <label class="flash-interval-row">
                    <span>色彩过渡</span>
                    <select v-model="flashEffectEdit.transitionMode">
                      <option value="smooth">渐变过渡</option>
                      <option value="step">硬切换</option>
                    </select>
                  </label>
                  <div class="color-grid">
                    <label v-for="(color, index) in flashEffectEdit.colors" :key="index" class="color-row flash-color-row">
                      <span>第 {{ index + 1 }} 色</span>
                      <input v-model="flashEffectEdit.colors[index]" type="color" />
                      <button class="mini-btn secondary" :disabled="flashEffectEdit.colors.length <= 1" @click.prevent="removeFlashColor(index)">删除</button>
                    </label>
                  </div>
                  <div class="action-grid">
                    <button class="mini-btn secondary" :disabled="flashEffectEdit.colors.length >= 10" @click="addFlashColor">增加颜色</button>
                  </div>
                </div>
              </template>
            </div>

            <aside class="appearance-preview-panel" :class="{ open: appearancePreviewOpen }">
              <header>
                <div>
                  <b>{{ activeAppearanceSection.label }}预览</b>
                  <small>预览跟随当前草稿变化。</small>
                </div>
                <button class="icon-btn appearance-preview-close" @click="appearancePreviewOpen = false" aria-label="关闭预览"><X :size="18" /></button>
                <span>{{ appearanceHasDraftChanges ? "未保存" : "已保存" }}</span>
              </header>
              <div class="appearance-preview-grid" :class="`preview-${appearanceSection}`">
                <template v-if="appearanceSection === 'brand'">
                  <div class="appearance-preview-block wide">
                    <strong>浏览器标签</strong>
                    <div class="appearance-device desktop">
                      <div class="preview-browser-bar large"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-brand-preview">
                        <img :src="appearanceDraftIcon" alt="" />
                        <b>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</b>
                        <small>浏览器标签页、收藏夹和安装后的应用入口会使用这组品牌信息。</small>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'login'">
                  <div class="appearance-preview-block">
                    <strong>桌面登录页</strong>
                    <div class="appearance-device desktop">
                      <div class="preview-browser-bar"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-login-preview" :class="`login-position-${loginAppearanceEdit.loginFormPosition}`" :style="appearancePreviewLoginStyle">
                        <div class="appearance-login-card">
                          <img v-if="loginAppearanceEdit.loginShowIcon" :src="appearanceDraftLoginIcon" alt="" />
                          <b>{{ loginAppearanceEdit.loginTitle || "Team Chat" }}</b>
                          <small v-if="loginAppearanceEdit.loginShowSubtitle">{{ loginAppearanceEdit.loginSubtitle || "轻快、稳定的团队聊天。" }}</small>
                          <span>{{ loginAppearanceEdit.registrationEnabled ? "登录 / 注册" : "登录" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="appearance-preview-block">
                    <strong>移动登录页</strong>
                    <div class="appearance-device mobile">
                      <div class="preview-browser-bar"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-login-preview" :class="`login-position-${loginAppearanceEdit.loginFormPosition}`" :style="appearancePreviewLoginStyle">
                        <div class="appearance-login-card">
                          <img v-if="loginAppearanceEdit.loginShowIcon" :src="appearanceDraftLoginIcon" alt="" />
                          <b>{{ loginAppearanceEdit.loginTitle || "Team Chat" }}</b>
                          <small v-if="loginAppearanceEdit.loginShowSubtitle">{{ loginAppearanceEdit.loginSubtitle || "轻快、稳定的团队聊天。" }}</small>
                          <span>{{ loginAppearanceEdit.registrationEnabled ? "登录 / 注册" : "登录" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'chat'">
                  <div class="appearance-preview-block">
                    <strong>桌面聊天室</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview" :style="appearancePreviewChatStyle">
                        <div class="appearance-chat-sidebar"><b>频道</b><span>主聊天室</span><span>代祷事项</span></div>
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">这是别人发来的消息。</p>
                          <p class="preview-message mine">这是自己的消息。</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="appearance-preview-block">
                    <strong>移动聊天室</strong>
                    <div class="appearance-device mobile">
                      <div class="appearance-chat-preview mobile-chat" :style="appearancePreviewChatStyle">
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">移动端消息</p>
                          <p class="preview-message mine">自己的回复</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'parallax'">
                  <div class="appearance-preview-block wide">
                    <strong>卷轴背景预览</strong>
                    <div class="appearance-device desktop parallax-preview-device">
                      <ParallaxBackground :kit="draftParallaxKit" :offset="74 * cleanParallaxSpeed(loginAppearanceEdit.parallaxSpeed)" preview />
                      <div class="parallax-preview-messages">
                        <p class="preview-message other">向上看历史，景色向左。</p>
                        <p class="preview-message mine">向下阅读，景色向右。</p>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'themes'">
                  <div class="appearance-preview-block wide">
                    <strong>主题效果</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview theme-preview" :style="appearanceThemePreviewStyle">
                        <div class="appearance-chat-sidebar"><b>频道</b><span>主聊天室</span><span>同工沟通</span></div>
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">对方消息颜色</p>
                          <p class="preview-message mine">我的消息颜色</p>
                          <button class="primary-btn">按钮预览</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="appearance-preview-block wide">
                    <strong>闪动消息</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview flash-preview">
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message mine flash" :style="appearancePreviewFlashStyle">/闪动 预览消息</p>
                          <small>颜色和过渡会按草稿实时变化。</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </aside>
          </section>

          <section v-else-if="adminPage === 'backups'" class="form-grid admin-page-section">
            <label>完整备份</label>
            <div class="admin-inline-card backup-card">
              <div>
                <strong>备份全部数据和程序</strong>
                <small>生成 ZIP 后会自动下载。备份包含聊天/用户导出、storage 数据、源码、配置和静态资源，不包含依赖目录、Git 元数据和已有备份。</small>
              </div>
              <button class="primary-btn" :disabled="adminBackupBusy" @click="createAdminBackup">
                <Download :size="16" />{{ adminBackupBusy ? "备份中" : "一键备份并下载" }}
              </button>
            </div>
            <div class="data-toolbar data-toolbar-compact">
              <button class="mini-btn secondary" :disabled="adminBackupBusy" @click="loadAdminBackups"><RotateCcw :size="15" />刷新备份</button>
            </div>
            <div class="admin-data-list backup-list">
              <article v-for="backup in adminBackups" :key="backup.fileName" class="admin-data-row backup-row">
                <div class="admin-data-main">
                  <strong>{{ backup.fileName }}</strong>
                  <small>{{ compactBytes(backup.size) }} · {{ adminDateTime(backup.createdAt) }}</small>
                </div>
                <div class="backup-actions">
                  <button class="mini-btn secondary" @click="downloadAdminFile(backup.url, backup.fileName)"><Download :size="15" />下载</button>
                  <button class="mini-btn danger-action" @click="deleteAdminBackup(backup)"><Trash2 :size="15" />删除</button>
                </div>
              </article>
              <p v-if="!adminBackups.length" class="empty-note">还没有完整备份</p>
            </div>
            <label>聊天数据</label>
            <div class="action-grid">
              <button class="primary-btn" @click="downloadAdminFile('/api/admin/export/chat', 'team-chat-data.zip')"><Download :size="16" />导出聊天</button>
              <label class="mini-btn secondary">
                <Upload :size="16" />导入聊天
                <input class="hidden" type="file" accept="application/zip,.zip,application/json,.json" @change="importAdminFile('/api/admin/import/chat', $event)" />
              </label>
            </div>
            <label>用户数据</label>
            <div class="action-grid">
              <button class="primary-btn" @click="downloadAdminFile('/api/admin/export/users', 'liao-users.zip')"><Download :size="16" />导出用户</button>
              <label class="mini-btn secondary">
                <Upload :size="16" />导入用户
                <input class="hidden" type="file" accept="application/zip,.zip,application/json,.json" @change="importAdminFile('/api/admin/import/users', $event)" />
              </label>
            </div>
          </section>

          <section v-else-if="adminPage === 'messages'" class="form-grid admin-page-section">
            <label>聊天记录删除</label>
            <div class="admin-inline-card">
              <div>
                <strong>在主聊天界面多选删除</strong>
                <small>回到当前频道后，可以按真实上下文选择多条消息并一次删除。</small>
              </div>
              <button class="primary-btn" @click="startMessageSelectionMode"><CheckCircle2 :size="16" />进入多选</button>
            </div>
            <div class="data-toolbar data-toolbar-compact">
              <select v-model.number="dataChannelFilter" aria-label="筛选频道">
                <option :value="0">全部频道</option>
                <option v-for="channel in store.channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
              </select>
              <button class="mini-btn danger-action" :disabled="!dataChannelFilter" @click="clearAdminMessages(dataChannelFilter)"><Trash2 :size="15" />清空当前频道</button>
              <button class="mini-btn danger-action" @click="clearAdminMessages(0)"><Trash2 :size="15" />清空全部记录</button>
            </div>
          </section>

          <section v-else-if="adminPage === 'resources'" class="admin-page-section">
            <AdminResourceManager
              :attachments="adminAttachments"
              :loading="adminAttachmentsLoading"
              :error="adminAttachmentsError"
              @refresh="loadAdminAttachments"
              @compress="compressAdminAttachments"
              @delete="deleteAdminAttachments"
              @delete-all="deleteAllAdminAttachments"
            />
          </section>

          <AdminBooksPage v-else-if="adminPage === 'books'" @message="adminMsg = $event" />

          <WeChatRelayPanel v-else-if="adminPage === 'wechatRelay'" />

          <DemoModePanel v-else-if="adminPage === 'demo'" />

          <section v-else-if="adminPage === 'release'" class="release-panel admin-page-section">
            <div class="release-head">
              <span>当前版本</span>
              <strong>v{{ APP_VERSION }}</strong>
              <small>{{ RELEASE_DATE }} · 开发者：{{ releaseDeveloper }}</small>
            </div>
            <div class="release-update-card">
              <div>
                <b>GitHub 更新</b>
                <small>
                  当前 v{{ updateCheck?.current || APP_VERSION }}
                  <template v-if="updateCheck"> · GitHub v{{ updateCheck.latest }}</template>
                </small>
                <small v-if="updateCheck || serverVersion?.update">
                  {{ updateCheck?.repo || serverVersion?.update?.repoUrl || "GitHub 仓库" }} · {{ updateRestartModeLabel }}
                </small>
              </div>
              <div class="release-update-actions">
                <label>
                  <span>更新分支</span>
                  <select v-model="selectedUpdateBranch" :disabled="updateBusy || !updateCheck" @change="checkForUpdates">
                    <option v-for="branch in updateCheck?.branches || []" :key="branch" :value="branch">{{ branch }}</option>
                  </select>
                </label>
                <button class="mini-btn secondary" :disabled="updateBusy" @click="checkForUpdates"><RotateCcw :size="15" />检查</button>
                <button class="mini-btn" :disabled="updateStartDisabled" @click="startServerUpdate">更新</button>
              </div>
              <div class="update-progress">
                <span :style="{ width: `${updateProgress}%` }"></span>
              </div>
              <small>{{ updateStateText }} · {{ updateStatus?.detail || "等待检查" }}</small>
              <ol v-if="updateStatus?.log.length" class="update-log">
                <li v-for="line in updateStatus.log.slice(-8)" :key="line">{{ line }}</li>
              </ol>
            </div>
            <div class="release-current">
              <b>本次更新</b>
              <ol>
                <li v-for="note in RELEASE_NOTES" :key="note">{{ note }}</li>
              </ol>
            </div>
            <div class="release-history">
              <article v-for="release in releaseHistory" :key="release.version" class="release-entry">
                <h3>v{{ release.version }} <small>{{ release.date }}</small></h3>
                <ol>
                  <li v-for="note in release.notes" :key="note">{{ note }}</li>
                </ol>
              </article>
            </div>
          </section>
        </div>
        <footer v-if="adminMsg" class="admin-msg" role="status" aria-live="polite">{{ adminMsg }}</footer>
      </div>
    </section>
</template>
