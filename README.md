# Team Chat

Team Chat is a lightweight web chat app for small groups. It feels familiar on mobile and desktop, supports voice messages, file sharing, image previews, channel management, direct chats, mentions, pinned notices, push notifications, and simple admin tools.

## What You Can Do

- Chat in public or private channels.
- Send text, images, files, and voice messages.
- See voice upload progress immediately after sending.
- Mention people with `@` suggestions.
- Use message effects from slash commands.
- Pin notices or messages for a channel.
- Manage users, channels, avatars, themes, files, and notification settings from the app.
- Import or export chat data from the admin tools.

## Requirements

- Node.js 22 or newer
- MySQL-compatible database
- `ffmpeg` installed on the server if you want voice messages transcoded to compact M4A files

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your database URL, JWT secret, storage path, and allowed origins.

4. Prepare the database:

   ```bash
   npm run prisma:generate
   npm run prisma:push
   ```

5. Start development mode:

   ```bash
   npm run dev
   ```

6. Build for production:

   ```bash
   npm run build
   npm start
   ```

## Configuration

Important environment variables:

- `DATABASE_URL`: MySQL connection string.
- `JWT_SECRET`: secret used to sign login sessions.
- `PORT`: server port. Defaults to `3003`.
- `STORAGE_ROOT`: directory for uploads, avatars, and backgrounds.
- `CORS_ORIGINS`: comma-separated list of public origins allowed to call the app.
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: optional web push settings.
- `ENGINE_API_TOKEN`: optional token for the virtual character engine API.

## Data And Privacy

Runtime data is stored outside the source code in `storage/` and in the configured database. Do not commit `.env`, `storage/`, database dumps, uploaded files, or deployment notes.

## License

Team Chat is released under the GNU General Public License v3.0. See [LICENSE](LICENSE).
