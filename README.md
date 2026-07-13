# Team Chat

Team Chat 是一个面向小团队、家庭、小组和私密社区的轻量网页聊天室。它同时照顾手机和桌面端使用，提供频道、私聊、文件、语音、提醒、主题、代祷卡片、AI 辅助经文建议、消息特效、管理后台、数据导入导出和服务器自更新能力。

项目以 **GPL-3.0-only** 发布。

## 功能概览

### AI 辅助经文建议

Team Chat 的 AI 辅助专注于代祷卡片下方的“也许相关的经文”子消息：AI 只推荐经文出处，不生成完整经文、不解释、不替代牧养辅导，也不评价代祷发起人。

- 管理员通过独立页面 `/ai-settings` 配置 AI，默认接入 DeepSeek v4 flash，思考关闭；通常只需要填写 API Key。
- AI 请求会把“命令”和“上下文”分开提交，上下文只包含代祷发起人和代祷信息。
- 每次建议返回 3 个经文出处，尽量避开同一张代祷卡片里已经推荐过的出处。
- 建议会保存为消息下方所有频道成员可见的子消息，最近显示 3 组；“换一组”会保存新的 AI 返回记录。
- 每张代祷卡片默认最多成功生成 7 次，并可在 `/ai-settings` 调整频率和上限。
- DeepSeek API Key 只保存在服务端，并使用 `AI_SETTINGS_SECRET` 加密；普通成员不会看到接口或密钥细节。
- 点击 AI 建议里的经文出处，会用应用内置的和合本简体经文数据库展开原文，不再请求 LLM。
- 内置经文查询支持常见中文/英文书卷别名、全角标点、单节、范围、跨章和同书卷连续片段；找不到时只显示温和提示。

### 聊天与频道

- 支持公开频道、私密频道和一对一私聊。
- 频道列表显示频道图标、频道名称和私密状态。
- 私聊频道只对参与双方可见，关闭私聊只会从自己的频道列表移除，不会删除历史记录。
- 频道创建者和管理员可以更新频道名称、描述和图标，也可以删除非默认频道。
- 聊天区按时间显示消息分隔，短消息频道也会保持完整聊天背景。
- 成员列表显示当前频道成员、虚拟角色和在线状态。
- 管理员可以从聊天区多选消息合并成一条置顶正文，置顶支持文字、图片和文件。
- 被授权为“户部尚书”的普通用户，可以在默认全员频道创建、编辑和撤下置顶消息。

### 消息能力

- 支持文字消息、图片消息、普通文件、音频文件、视频文件和语音消息。
- 文字消息会做服务端清洗，只保留安全的基础格式和链接。
- 输入 `@` 会弹出成员补全，支持键盘选择和点击选择。
- 被 @ 的用户会看到顶部提醒，提醒可点击定位到对应消息。
- 支持回复消息，桌面端长按气泡引用，移动端点按普通消息引用。
- 自己发送的普通消息在 2 分钟内可以撤回，撤回后频道内显示系统提示。
- 管理员可以在聊天区进入多选模式，按当前上下文批量删除聊天记录。

### 斜杠命令与消息特效

在输入框输入 `/` 会显示可用命令。特效会保存在消息 payload 中，其他用户实时看到同样效果。多数持续特效可以点按气泡暂停或恢复。

- `/闪动`：气泡持续切换颜色，自动搭配可读文字色。
- `/流光`：文字呈现金属扫光效果。
- `/震动`：气泡持续轻微摇晃。
- `/飞机`：文字在聊天区横向循环飞行。
- `/光芒万丈`：消息气泡向外放射太阳般的光芒。
- `/跑马灯`：气泡外圈出现彩色 chasing light，适合节日氛围。
- `/水波`：气泡变成水面，带波纹和高光；手机倾斜时水面会跟随移动，桌面端鼠标划过会搅动水波。
- `/水滴`：气泡底部凝结水滴，液滴带重力下落，碰到其他消息气泡会溅开水花。
- `/下雨`：一次性聊天室天气效果。消息发出后整个聊天区下 15 秒大雨；同一条消息不会因为再次点击而重播，播放中点击也不会中断。
- `/哎呀`：文字初始正常显示，点一下后会在当前设备随机逐字掉落、碰撞并堆在其他气泡或输入区上；再点掉落文字或原气泡会反重力归位。

### 代祷卡片

代祷卡片把普通聊天里的代祷请求变成可持续跟进的事项。它仍然出现在聊天流里，但拥有独立状态、祷告记录、相关经文建议和每频道的集中视图。

创建和展示：

- 输入 `/代祷 内容` 可以生成频道代祷卡片。
- `/代祷` 后可以叠加消息特效，例如 `/代祷 /流光 请为今晚休息祷告`。
- 代祷卡片显示当前状态、祷告人数、祷告记录次数、最近祷告时间和参与者头像。
- 只有已经有代祷卡片的频道才会显示“代祷事项”子入口，用来集中查看该频道原始代祷卡片；普通聊天里复发的最新动态不会在子入口里重复收录成新卡片。

参与和跟进：

- 成员可以点“我已祷告”记录一次祷告；已经记录过的人可以点“再次记录祷告”继续累加次数。
- 发起者可以把代祷事项标记为“无需再代祷”或“已蒙应允”，也可以撤回事项。
- 发起者或管理员可以点“更新最新动态”，在编辑框里修改内容；若某部分已无需代祷或已蒙应允，可选中文字后点“划去选中文字”，确认后才会更新原卡片。
- 最新动态发布后，同一张代祷卡会作为聊天区最新消息再发一次，并向可访问该频道的成员推送通知；它仍指向原卡片的祷告记录和经文建议。

AI 经文建议：

- 启用 AI 后，成员可以在代祷卡片下方生成“也许相关的经文”，AI 只返回经文出处。
- 点击出处会用内置和合本简体经文数据库展开原文，不再请求 LLM。
- 建议、换一组次数、冷却时间和每张卡的成功生成上限都保存在服务端，管理员可在 `/ai-settings` 调整。

适合场景：

- 一次性代祷：发布请求，成员记录祷告，事项结束后标记“无需再代祷”。
- 持续跟进：发起者定期用“更新最新动态”补充近况，让请求重新回到聊天最新位置，同时保留同一张卡的历史祷告统计。
- 蒙应允见证：把状态改为“已蒙应允”，让频道成员知道事项已经有了新的结果。

### 语音、图片和文件

- 语音消息发送后立即出现在聊天区，并显示上传进度。
- 语音上传失败时保留失败状态，可以重试或移除。
- 语音消息显示波形、时长、播放进度和未收听状态。
- 图片可在聊天中预览，点击后进入沉浸式大图查看，支持放大和拖动。
- 常见文档显示本地风格文件图标，包括 PDF、Word、Excel、PowerPoint、文本和通用文件。
- 可预览的媒体尽量直接打开，不适合预览的文件会走下载确认。

### 通知与在线状态

- 支持浏览器推送通知，桌面端和移动端都可以接收新消息提醒。
- 通知点击后会回到聊天室并自动切换到对应频道。
- 聊天顶部会用疯狂晃动的通知标志提醒未开启通知的用户，标志按 `🔔 → 🔕 → 😴` 变化，点击可进行通知体检、开启通知并发送测试通知。
- 设置页可以为当前设备开启、关闭或测试通知。
- 支持按频道静音普通消息；置顶消息创建和编辑会向所在频道所有人发送推送。
- 成员列表和消息头像旁显示在线绿点。
- 多人正在输入时，顶部提示会轮换显示。

### 外观与个性化

- 内置微信绿、竹影、纸墨和夜间主题。
- 管理员可以创建自定义主题，调整按钮、背景、面板、文字和气泡颜色。
- 支持聊天室壁纸，壁纸可选择填满、适合、拉伸或平铺。
- 支持独立的多层卷轴背景；消息滚动会驱动背景横向移动，管理员可以创建套件、上传透明 PNG，并逐层调整前后顺序、速度比、上下位置和画布高度。
- 登录页支持自定义图标、标题、副标题、背景图和表单位置。
- 管理员外观页按品牌与标签页、登录页、聊天室、主题颜色和闪动特效分组，桌面端实时预览当前场景，手机端可按需打开预览。
- 外观图片在更换时弹出选择器，可上传新图片或复用已有外观素材；所有图片、主题和闪动特效改动都会先进入草稿，点击“保存外观”后才生效。
- 手机端使用安全区变量和动态高度，适配 Safari 底栏、键盘和添加到主屏幕后运行的场景。

### 管理后台

- 管理员可以创建用户、修改显示名、重置密码和授予管理员权限。
- 管理员可以把普通用户设为“户部尚书”，让其只在默认全员频道拥有置顶消息权限。
- 管理员可以创建虚拟角色，用于外部角色引擎或自动化接入。
- 管理员可以创建、编辑、删除频道，并维护频道图标。
- 支持频道置顶消息快照；置顶默认展开，用户收起后会按账号记住当前版本已看过，置顶更新后重新展开。
- 置顶内容可以二次编辑，旧置顶公告会兼容为纯文本置顶正文。
- 数据页可以搜索聊天记录、删除单条记录、清空当前频道或清空全部频道。
- 资源管理可以查看上传文件、语音、头像、壁纸、登录图、频道图标和置顶引用，支持搜索、来源/类型/状态筛选、排序、分页、缺失文件识别、安全预览、压缩和批量删除。
- 删除聊天记录会同步清理相关上传文件；删除附件会保留消息并显示删除提示。

### 版本与更新

- 应用内设置页和管理员版本页显示当前版本号、发布日期、开发者名和完整更新记录。
- 客户端会定期检查服务器版本；手机或旧浏览器发现服务器已更新后，会自动刷新或提示手动刷新。
- 管理员版本页可以检测 GitHub 最新版本，并触发服务器自更新。
- 自更新过程显示状态、进度和最近日志。
- 自更新支持 `UPDATE_RESTART_MODE=pm2|command|none`：默认使用 PM2，也可通过 `UPDATE_RESTART_COMMAND` 指定 systemd 或其它重启命令。
- 部署环境可通过 `APP_RELEASE_DEVELOPER` 覆盖版本页显示的开发者名。

### 数据导入导出

- 管理员可以导出频道、成员、消息、置顶、语音收听状态、代祷记录和置顶正文快照。
- 管理员可以导入备份数据，用于迁移或恢复。
- 支持按用户导出其附件 ZIP。
- 支持删除指定用户历史附件，并保留对应消息记录。
- 运行时数据应放在源码目录外或被 `.gitignore` 排除，不应提交 `.env`、数据库、上传文件和部署私密说明。

## English Overview

Team Chat is a lightweight web chat app for small teams, families, groups, and private communities. It is built for both mobile and desktop use, and includes channels, direct messages, files, voice messages, browser push notifications, themes, prayer cards, AI-assisted Bible reference suggestions, message effects, admin tools, data import/export, and server self-update support.

### Prayer Cards

- `/代祷 content` creates a prayer card in the current channel.
- Prayer cards track status, unique people who prayed, total prayer actions, latest prayer time, and participant avatars.
- Members can record “I prayed” more than once, so long-running requests can show continued prayer rather than a single checkbox.
- The requester can close a request, mark it answered, withdraw it, or publish a latest update.
- Publishing a latest update opens an editor first. The requester can revise the text, strike through answered or no-longer-needed portions, and then update the original card, repost it as the newest channel message, and send push notifications.
- Channels show a Prayer Items sub-view only after they have at least one prayer card. Reposted latest updates stay in the chat flow but are not collected as duplicate cards.
- AI Bible reference suggestions stay attached to the canonical prayer card, so reposted updates keep the same prayer counts and suggestion history.

### AI Bible Reference Suggestions

- Prayer cards can ask AI for “possibly related Bible references.”
- The assistant only returns references, not full passages, explanations, sermons, judgments, or counseling.
- Suggestions are stored under the prayer card, can be regenerated within configured limits, and can be expanded through the built-in Chinese Union Version lookup.

### Appearance And Personalization

- Built-in themes include WeChat Green, Jade, Paper, and Night.
- Admins can create custom themes for buttons, backgrounds, panels, text, and chat bubbles.
- Chat wallpapers support cover, contain, stretch, and repeat display modes.
- Layered parallax backgrounds move horizontally with message scrolling; admins can upload kits and tune each layer's order, speed, vertical offset, and canvas height.
- The login page supports custom icons, title, subtitle, background image, form position, and registration entry.
- The admin appearance panel is organized by scenario: brand and browser tab, login page, chat room, theme colors, and flashing message effect.
- Appearance images are chosen through a shared picker when they are needed. Admins can upload a new image or reuse existing appearance assets.
- Image, theme, and flashing-effect changes stay in a draft preview until the admin clicks “Save appearance”.

### Admin Tools

- Admins can create users, reset passwords, update display names, assign admin rights, and grant default-channel pinning permission.
- Admins can create, edit, and delete channels, maintain channel icons, and manage virtual characters for external engines or automation.
- The admin panel supports pinned-message snapshots, chat data import/export, user export, attachment cleanup, image compression, and release/update checks.
- The in-app version page shows the current version, release date, developer label, current release notes, and full release history.

## 一键 VPS 部署

建议使用全新的 Ubuntu 或 Debian VPS。若需要 HTTPS，请先把域名解析到服务器。

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo env DOMAIN=chat.example.com EMAIL=you@example.com bash deploy-vps.sh
```

替换：

- `chat.example.com`：你的公开访问域名。
- `you@example.com`：申请 HTTPS 证书使用的邮箱。

没有域名时也可以先用 HTTP 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo bash deploy-vps.sh
```

安装脚本会完成：

- 安装 Node.js 22、MySQL、Nginx、PM2、ffmpeg 和编译工具。
- 创建 MySQL 数据库和应用账号。
- 生成应用密钥和初始管理员密码。
- 安装依赖并构建 Team Chat。
- 用 PM2 启动服务。
- 配置 Nginx 反向代理。
- 在提供 `DOMAIN` 和 `EMAIL` 时申请 Let's Encrypt HTTPS 证书。
- 写入更新器配置，让管理员之后可以在应用内检查并执行 GitHub 更新。

常用服务命令：

```bash
pm2 status team-chat
pm2 logs team-chat
pm2 restart team-chat --update-env
```

## 手动开发与部署

开发前先看 [Development Index](docs/development-index.md)。它记录了模块地图、常见回归区、移动端弹窗/手势检查清单和发布前检查命令。

环境要求：

- Node.js 22 或更新版本。
- MySQL 兼容数据库。
- `ffmpeg`，用于语音消息压缩转码。

安装依赖：

```bash
npm install
```

复制环境变量示例：

```bash
cp .env.example .env
```

编辑 `.env` 后初始化数据库：

```bash
npm run prisma:generate
npm run prisma:push
```

启动开发模式：

```bash
npm run dev
```

类型检查：

```bash
npm run check
```

构建生产版本：

```bash
npm run build
```

启动生产服务：

```bash
npm start
```

## 重要环境变量

- `DATABASE_URL`：MySQL 连接字符串。
- `NODE_ENV`：生产环境应设为 `production`，用于启用强制安全配置检查。
- `JWT_SECRET`：登录会话签名密钥；生产环境至少 32 个字符。
- `DEFAULT_ADMIN_PASSWORD`：数据库为空时创建初始 `admin` 账号使用的密码；首次生产启动至少 12 个字符。
- `PORT`：服务端口，默认 `3003`。
- `STORAGE_ROOT`：上传文件、头像和背景图存储目录。
- `CORS_ORIGINS`：允许调用应用的公开来源，多个来源用逗号分隔。
- `TRUST_PROXY`：默认仅信任本机反向代理；只有整个代理网络均可信时才设为 `true`。
- `VAPID_SUBJECT`、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`：浏览器推送通知配置。
- `PUSH_NOTIFICATIONS_ENABLED=false`：彻底关闭 Web Push；Demo/测试环境复制生产用户时必须关闭，防止误通知真实设备。
- `ENGINE_API_TOKEN`：虚拟角色引擎接口令牌。
- `AI_SETTINGS_SECRET`：AI 设置中 API Key 的服务端加密密钥，建议单独设置并长期保存。
- `APP_RELEASE_DEVELOPER`：应用内版本页显示的开发者名。
- `UPDATE_REPO_URL`、`UPDATE_BRANCH`：管理员自更新功能使用的 GitHub 仓库和分支。
- `UPDATE_RESTART_MODE`、`UPDATE_PM2_APP`、`UPDATE_RESTART_COMMAND`：自更新完成后的重启方式；`pm2` 使用 PM2 应用名，`command` 执行自定义命令，`none` 只同步文件并提示手动重启。

### 卷轴背景素材

卷轴 PNG 属于运行时素材，不随 GPL 源码发布。`rural` 套件需要由部署者按原作者许可取得，并将 10 个原始 PNG 放入 `${STORAGE_ROOT}/parallax/rural/`。管理员也可以在外观后台创建自定义套件并上传图层，文件会转换为 PNG 存入 `${STORAGE_ROOT}/parallax/<kit-id>/`；套件与层级配置保存在应用设置中。默认层级定义见 `src/shared/parallax.ts`。

## 安全与发布注意事项

- 不要提交 `.env`、`storage/`、数据库文件、上传附件、服务器地址或私有部署说明。
- 公开发布前确认 `package.json` 保持 `GPL-3.0-only`。
- 部署前先本地运行 `npm run check` 和 `npm run build`。
- 如果启用自更新，确保运行用户只拥有当前应用所需权限。

## License

Team Chat is released under the GNU General Public License v3.0 only. See [LICENSE](LICENSE).
