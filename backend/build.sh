#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════╗
# ║  backend/build.sh                                    ║
# ║  Install deps → Setup MySQL → Configure → Build → Run║
# ╚═══════════════════════════════════════════════════════╝
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PORT=${1:-8080}
BUILD_DIR="$(dirname "$0")/build"

# ── MySQL connection settings — change these if needed ────────
DB_HOST="127.0.0.1"
DB_PORT=3306
DB_NAME="tihanfly_db"
DB_USER="tihanfly"
DB_PASS="tihanfly123"
# ─────────────────────────────────────────────────────────────

banner() { echo -e "${CYAN}▶  $*${NC}"; }
ok()     { echo -e "${GREEN}✓  $*${NC}"; }
warn()   { echo -e "${YELLOW}⚠  $*${NC}"; }
err()    { echo -e "${RED}✗  $*${NC}"; exit 1; }

echo -e "${CYAN}"
cat <<'EOF'
╔══════════════════════════════════════════════╗
║   TiHANFly GCS — Backend Builder (MySQL)    ║
╚══════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# ── 1. System dependencies ────────────────────────────────────
banner "Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    build-essential \
    cmake \
    pkg-config \
    libasio-dev \
    libboost-system-dev \
    libboost-thread-dev \
    default-libmysqlclient-dev \
    libssl-dev \
    nlohmann-json3-dev \
    mysql-client
ok "Dependencies installed"

# ── 2. MySQL server check ─────────────────────────────────────
banner "Checking MySQL server..."
if ! command -v mysql &>/dev/null; then
    warn "MySQL client not found — install MySQL server manually."
    warn "  Ubuntu/Debian:  sudo apt install mysql-server"
    warn "  Then run:       sudo mysql_secure_installation"
fi

# ── 3. Create DB + user ───────────────────────────────────────
banner "Setting up MySQL database and user..."

SQL_SETUP="CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}'; GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost'; FLUSH PRIVILEGES;"

if sudo mysql --silent -e "${SQL_SETUP}" 2>/dev/null; then
    ok "MySQL database '${DB_NAME}' and user '${DB_USER}' created"
else
    warn "Could not auto-create DB as root. Run this manually in MySQL as root:"
    echo ""
    echo -e "${YELLOW}  CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    echo "  CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
    echo "  GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
    echo -e "  FLUSH PRIVILEGES;${NC}"
    echo ""
fi

# ── 4. Test connection ────────────────────────────────────────
banner "Testing MySQL connection..."
if mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASS}" \
         "${DB_NAME}" -e "SELECT 1;" &>/dev/null; then
    ok "Connection to MySQL successful"
else
    err "Cannot connect to MySQL as '${DB_USER}'. Check credentials or set up DB manually."
fi

# ── 5. Configure CMake ────────────────────────────────────────
banner "Configuring CMake..."
mkdir -p "$BUILD_DIR"
cmake -S "$(dirname "$0")" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
ok "CMake configured"

# ── 6. Build ──────────────────────────────────────────────────
banner "Compiling ($(nproc) cores)..."
cmake --build "$BUILD_DIR" --parallel "$(nproc)"
ok "Build complete → $BUILD_DIR/tihanfly_server"

# ── 7. Run ────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Server built successfully!                          ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  WebSocket URL : ws://${SERVER_IP}:${PORT}           ${NC}"
echo -e "${GREEN}║  MySQL DB      : ${DB_NAME} @ ${DB_HOST}:${DB_PORT}  ${NC}"
echo -e "${GREEN}║  Update login.js: WS_URL = 'ws://${SERVER_IP}:${PORT}'${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

banner "Starting server on port $PORT..."
"$BUILD_DIR/tihanfly_server" "$PORT"