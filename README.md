# Team Chat

Language: **English** | [中文](#中文说明)

Team Chat is a lightweight web chat app for small groups. It works well on phones and desktops, and includes voice messages, file sharing, image previews, channels, direct chats, mentions, prayer cards, pinned notices, push notifications, themes, version-aware refresh, and admin tools.

## One-Click VPS Install

Use a fresh Ubuntu or Debian VPS. Point your domain to the VPS first if you want HTTPS.

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo env DOMAIN=chat.example.com EMAIL=you@example.com bash deploy-vps.sh
```

Replace:

- `chat.example.com` with your domain.
- `you@example.com` with the email used for the HTTPS certificate.

When the installer finishes, it prints the login address and the first admin password. Save that password immediately.

If you do not have a domain yet, you can still install over plain HTTP:

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo bash deploy-vps.sh
```

The installer will:

- install Node.js 22, MySQL, Nginx, PM2, ffmpeg, and build tools;
- create a MySQL database and app user;
- generate app secrets and a first admin password;
- build Team Chat;
- start it with PM2;
- configure Nginx as a reverse proxy;
- request a Let's Encrypt certificate when `DOMAIN` and `EMAIL` are provided;
- write updater settings so admins can later check GitHub for a newer version from the app.

Useful server commands:

```bash
pm2 status team-chat
pm2 logs team-chat
pm2 restart team-chat --update-env
```

## What You Can Do

- Chat in public or private channels.
- Send text, images, files, and voice messages.
- See voice upload progress immediately after sending.
- Mention people with `@` suggestions.
- Use message effects from slash commands.
- Send `/代祷` prayer cards, record who has prayed, and keep channel prayer items together.
- Recall your own messages within 2 minutes.
- Refresh stale mobile clients automatically when the server version is newer.
- Pin notices or messages for a channel.
- Manage users, channels, avatars, themes, files, and notification settings from the app.
- Check GitHub for newer releases and run an in-app server update with progress details.
- Import or export chat data from the admin tools.

## Manual Setup

Requirements:

- Node.js 22 or newer
- MySQL-compatible database
- `ffmpeg` for compact voice message transcoding

Install dependencies:

```bash
npm install
```

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env`, then prepare the database:

```bash
npm run prisma:generate
npm run prisma:push
```

Start development mode:

```bash
npm run dev
```

Build and run production mode:

```bash
npm run build
npm start
```

## Configuration

Important environment variables:

- `DATABASE_URL`: MySQL connection string.
- `JWT_SECRET`: secret used to sign login sessions.
- `DEFAULT_ADMIN_PASSWORD`: password used for the first `admin` account when the database is empty.
- `PORT`: server port. Defaults to `3003`.
- `STORAGE_ROOT`: directory for uploads, avatars, and backgrounds.
- `CORS_ORIGINS`: comma-separated list of public origins allowed to call the app.
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: optional web push settings.
- `ENGINE_API_TOKEN`: optional token for the virtual character engine API.
- `APP_RELEASE_DEVELOPER`: optional display name shown on the in-app version page.
- `UPDATE_REPO_URL`, `UPDATE_BRANCH`, `UPDATE_PM2_APP`: optional settings for the admin GitHub update tool.

## Data And Privacy

Runtime data is stored outside the source code in `storage/` and in the configured database. Do not commit `.env`, `storage/`, database dumps, uploaded files, or deployment notes.

## License

Team Chat is released under the GNU General Public License v3.0. See [LICENSE](LICENSE).

---

# 中文说明

语言：[English](#team-chat) | **中文**

Team Chat 是一个适合小团队使用的轻量聊天室。它支持手机和电脑访问，包含语音消息、文件分享、图片预览、频道、私聊、@ 提醒、代祷卡片、置顶公告、浏览器通知、主题、版本刷新和管理工具。

## VPS 一键部署

建议使用全新的 Ubuntu 或 Debian VPS。如果你想启用 HTTPS，请先把域名解析到这台 VPS。

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo env DOMAIN=chat.example.com EMAIL=you@example.com bash deploy-vps.sh
```

把下面两项替换成你自己的信息：

- `chat.example.com`：你的域名。
- `you@example.com`：用于申请 HTTPS 证书的邮箱。

安装完成后，脚本会显示访问地址和初始管理员密码。请立刻保存这个密码。

如果你还没有域名，也可以先用 HTTP 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/ttmanthatman/tm3/main/scripts/deploy-vps.sh -o deploy-vps.sh
sudo bash deploy-vps.sh
```

脚本会自动完成：

- 安装 Node.js 22、MySQL、Nginx、PM2、ffmpeg 和编译工具；
- 创建 MySQL 数据库和应用账号；
- 生成应用密钥和初始管理员密码；
- 构建 Team Chat；
- 用 PM2 启动服务；
- 配置 Nginx 反向代理；
- 在提供 `DOMAIN` 和 `EMAIL` 时申请 Let's Encrypt HTTPS 证书；
- 写入更新器配置，之后管理员可以在应用内检查 GitHub 新版本。

常用服务器命令：

```bash
pm2 status team-chat
pm2 logs team-chat
pm2 restart team-chat --update-env
```

## 主要功能

- 在公开频道或私密频道聊天。
- 发送文字、图片、文件和语音消息。
- 语音发送后立即显示上传进度。
- 输入 `@` 时补全成员。
- 使用斜杠命令发送消息特效。
- 发送 `/代祷` 代祷卡片，记录已祷告成员，并集中查看频道代祷事项。
- 自己发送的消息 2 分钟内可以撤回。
- 手机或旧浏览器版本落后于服务器时会自动刷新或提示刷新。
- 为频道置顶公告或消息。
- 在应用内管理用户、频道、头像、主题、文件和通知设置。
- 管理员可以检测 GitHub 新版本，并在应用内带进度执行服务器更新。
- 在管理工具中导入或导出聊天数据。

## 手动安装

环境要求：

- Node.js 22 或更新版本
- MySQL 兼容数据库
- 用于语音压缩转码的 `ffmpeg`

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

构建并以生产模式运行：

```bash
npm run build
npm start
```

## 配置说明

常用环境变量：

- `DATABASE_URL`：MySQL 连接字符串。
- `JWT_SECRET`：登录会话签名密钥。
- `DEFAULT_ADMIN_PASSWORD`：数据库为空时创建第一个 `admin` 用户所用的密码。
- `PORT`：服务端口，默认 `3003`。
- `STORAGE_ROOT`：上传文件、头像和背景图的存储目录。
- `CORS_ORIGINS`：允许访问应用 API 的公开域名，多个值用英文逗号分隔。
- `VAPID_SUBJECT`、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`：可选的浏览器推送配置。
- `ENGINE_API_TOKEN`：可选的虚拟角色引擎 API token。
- `APP_RELEASE_DEVELOPER`：可选，显示在应用版本页的开发者名称。
- `UPDATE_REPO_URL`、`UPDATE_BRANCH`、`UPDATE_PM2_APP`：可选，管理员 GitHub 更新工具使用的仓库、分支和 PM2 应用名。

## 数据与隐私

运行时数据保存在 `storage/` 和配置的数据库中。不要提交 `.env`、`storage/`、数据库备份、上传文件或部署笔记。

## 许可证

Team Chat 使用 GNU General Public License v3.0 发布，详见 [LICENSE](LICENSE)。
