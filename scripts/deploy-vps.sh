#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-team-chat}"
APP_DIR="${APP_DIR:-/opt/team-chat}"
REPO_URL="${REPO_URL:-https://github.com/ttmanthatman/tm3.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3003}"
APP_RELEASE_DEVELOPER="${APP_RELEASE_DEVELOPER:-Team Chat}"
UPDATE_REPO_URL="${UPDATE_REPO_URL:-$REPO_URL}"
UPDATE_BRANCH="${UPDATE_BRANCH:-$BRANCH}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
DB_NAME="${DB_NAME:-team_chat}"
DB_USER="${DB_USER:-team_chat}"
DB_PASSWORD="${DB_PASSWORD:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
SERVER_IP="${SERVER_IP:-}"

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "Please run this script as root, for example: sudo bash scripts/deploy-vps.sh"
  fi
}

detect_os() {
  if [ ! -r /etc/os-release ]; then
    fail "This installer supports Debian/Ubuntu VPS images."
  fi
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*) ;;
        *) fail "Unsupported OS: ${PRETTY_NAME:-unknown}. Please use Ubuntu or Debian." ;;
      esac
      ;;
  esac
}

random_secret() {
  openssl rand -base64 32 | tr -d '\n'
}

random_password() {
  openssl rand -hex 18
}

detect_server_ip() {
  if [ -n "$SERVER_IP" ]; then
    return
  fi
  SERVER_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$SERVER_IP" ]; then
    SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
}

validate_identifier() {
  local value="$1"
  local label="$2"
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_]+$'; then
    fail "$label may only contain letters, numbers, and underscores."
  fi
}

validate_service_name() {
  local value="$1"
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_.-]+$'; then
    fail "APP_NAME may only contain letters, numbers, dots, underscores, and dashes."
  fi
}

public_origins() {
  if [ -n "$DOMAIN" ]; then
    printf 'https://%s,http://%s' "$DOMAIN" "$DOMAIN"
  else
    printf 'http://%s,http://127.0.0.1:%s' "${SERVER_IP:-127.0.0.1}" "$PORT"
  fi
}

install_packages() {
  info "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl rsync nginx mysql-server ffmpeg build-essential
  systemctl enable --now mysql >/dev/null 2>&1 || true
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
    info "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  npm install -g pm2
}

setup_mysql() {
  validate_identifier "$DB_NAME" "DB_NAME"
  validate_identifier "$DB_USER" "DB_USER"
  DB_PASSWORD="${DB_PASSWORD:-$(random_password)}"
  info "Creating MySQL database and user"
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
}

checkout_code() {
  info "Preparing application directory: $APP_DIR"
  mkdir -p "$APP_DIR"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  else
    rm -rf "$APP_DIR.tmp"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR.tmp"
    rsync -a --exclude .git "$APP_DIR.tmp"/ "$APP_DIR"/
    rm -rf "$APP_DIR.tmp"
    git -C "$APP_DIR" init >/dev/null
    git -C "$APP_DIR" remote add origin "$REPO_URL"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  fi
}

write_env() {
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(random_password)}"
  local jwt_secret
  local engine_token
  jwt_secret="$(random_secret)"
  engine_token="$(random_secret)"
  info "Writing application environment"
  mkdir -p "$APP_DIR/storage"
  cat >"$APP_DIR/.env" <<EOF_ENV
DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:3306/${DB_NAME}"
JWT_SECRET="${jwt_secret}"
ENGINE_API_TOKEN="${engine_token}"
DEFAULT_ADMIN_PASSWORD="${ADMIN_PASSWORD}"
PORT=${PORT}
STORAGE_ROOT="${APP_DIR}/storage"
CORS_ORIGINS="$(public_origins)"
VAPID_SUBJECT="mailto:${EMAIL:-admin@example.com}"
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
APP_RELEASE_DEVELOPER="${APP_RELEASE_DEVELOPER}"
UPDATE_REPO_URL="${UPDATE_REPO_URL}"
UPDATE_BRANCH="${UPDATE_BRANCH}"
UPDATE_PM2_APP="${APP_NAME}"
EOF_ENV
  chmod 600 "$APP_DIR/.env"
}

build_app() {
  info "Installing app dependencies and building"
  cd "$APP_DIR"
  chmod +x scripts/self-update.sh
  npm ci
  npm run prisma:generate
  npm run prisma:push
  npm run build
}

start_pm2() {
  info "Starting PM2 service"
  cd "$APP_DIR"
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start dist/server/server/index.js --name "$APP_NAME" --update-env
  fi
  pm2 save
  if command -v systemctl >/dev/null 2>&1; then
    pm2 startup systemd -u root --hp /root >/dev/null || true
  fi
}

write_nginx() {
  info "Configuring Nginx"
  local server_name="_"
  if [ -n "$DOMAIN" ]; then
    server_name="$DOMAIN"
  fi
  cat >"/etc/nginx/sites-available/${APP_NAME}.conf" <<EOF_NGINX
server {
    listen 80;
    server_name ${server_name};
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF_NGINX
  ln -sf "/etc/nginx/sites-available/${APP_NAME}.conf" "/etc/nginx/sites-enabled/${APP_NAME}.conf"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx
}

setup_ssl() {
  if [ -z "$DOMAIN" ]; then
    warn "DOMAIN is empty, skipping HTTPS. Set DOMAIN=chat.example.com to enable HTTPS."
    return
  fi
  if [ "$ENABLE_SSL" = "0" ] || [ "$ENABLE_SSL" = "false" ]; then
    warn "ENABLE_SSL is disabled, skipping HTTPS."
    return
  fi
  if [ "$ENABLE_SSL" = "auto" ] && [ -z "$EMAIL" ]; then
    warn "EMAIL is empty, skipping Let's Encrypt. Re-run with EMAIL=you@example.com to enable HTTPS."
    return
  fi
  info "Installing HTTPS certificate"
  apt-get install -y certbot python3-certbot-nginx
  if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    warn "Could not issue the HTTPS certificate. The app is still available over HTTP. Check DNS and run certbot again later."
  fi
}

print_summary() {
  local url="http://${SERVER_IP:-127.0.0.1}"
  if [ -n "$DOMAIN" ]; then
    if [ -n "$EMAIL" ] && [ "$ENABLE_SSL" != "0" ] && [ "$ENABLE_SSL" != "false" ]; then
      url="https://${DOMAIN}"
    else
      url="http://${DOMAIN}"
    fi
  fi
  cat <<EOF_SUMMARY

Team Chat is installed.

URL: ${url}
Admin username: ${ADMIN_USERNAME}
Admin password: ${ADMIN_PASSWORD}
App directory: ${APP_DIR}
PM2 app: ${APP_NAME}

Save the admin password now. It is only printed at install time.

Useful commands:
  pm2 status ${APP_NAME}
  pm2 logs ${APP_NAME}
  pm2 restart ${APP_NAME} --update-env

EOF_SUMMARY
}

main() {
  need_root
  detect_os
  validate_service_name "$APP_NAME"
  install_packages
  detect_server_ip
  setup_mysql
  checkout_code
  write_env
  build_app
  start_pm2
  write_nginx
  setup_ssl
  print_summary
}

main "$@"
