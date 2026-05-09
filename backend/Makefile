# ╔══════════════════════════════════════════════╗
# ║   TiHANFly GCS — Master Makefile            ║
# ║                                             ║
# ║   make          → build + run server        ║
# ║   make db       → view database             ║
# ║   make rebuild  → clean + build + run       ║
# ║   make stop     → stop running server       ║
# ║   make clean    → delete build files        ║
# ╚══════════════════════════════════════════════╝

SHELL    := /bin/bash
PORT     ?= 8080
DB_HOST  := 127.0.0.1
DB_PORT  := 3306
DB_NAME  := tihanfly_db
DB_USER  := tihanfly
DB_PASS  := tihanfly123
BUILD    := ./build
MYSQL    := mysql -h$(DB_HOST) -P$(DB_PORT) -u$(DB_USER) -p$(DB_PASS) $(DB_NAME) 2>/dev/null

.PHONY: all
all: build run

.PHONY: build
build:
	@echo -e "\033[0;36m\033[1m▶  Building TiHANFly server...\033[0m"
	@mkdir -p $(BUILD)
	@cmake -S . -B $(BUILD) -DCMAKE_BUILD_TYPE=Release -Wno-dev > /dev/null
	@cmake --build $(BUILD) --parallel $$(nproc)
	@echo -e "\033[0;32m\033[1m✓  Build complete\033[0m"

.PHONY: run
run:
	@echo -e "\033[0;32m\033[1m▶  Starting server on port $(PORT)...\033[0m"
	@$(BUILD)/tihanfly_server $(PORT)

.PHONY: rebuild
rebuild: clean build run

.PHONY: db
db:
	@clear
	@echo -e "\033[0;36m\033[1m"
	@echo "╔══════════════════════════════════════════════════════════════╗"
	@echo "║           TiHANFly GCS — Database Viewer                    ║"
	@echo "╚══════════════════════════════════════════════════════════════╝"
	@echo -e "\033[0m"
	@echo -e "\033[1;33m\033[1m  📊  LIVE STATS\033[0m"
	@echo -e "\033[1;33m  ─────────────────────────────────────────\033[0m"
	@printf "  Total Users  : \033[1m%s\033[0m\n" $$($(MYSQL) --silent -e "SELECT COUNT(*) FROM users;")
	@printf "  \033[0;32mActive       : \033[1m%s\033[0m\n" $$($(MYSQL) --silent -e "SELECT COUNT(*) FROM users WHERE status='active';")
	@printf "  \033[1;33mPending      : \033[1m%s\033[0m\n" $$($(MYSQL) --silent -e "SELECT COUNT(*) FROM users WHERE status='pending';")
	@printf "  \033[0;31mDisabled     : \033[1m%s\033[0m\n" $$($(MYSQL) --silent -e "SELECT COUNT(*) FROM users WHERE status='inactive' OR status='rejected';")
	@printf "  \033[0;36mJoined Today : \033[1m%s\033[0m\n" $$($(MYSQL) --silent -e "SELECT COUNT(*) FROM users WHERE DATE(registered_at)=CURDATE();")
	@echo ""
	@echo -e "\033[0;36m\033[1m  👤  USERS\033[0m"
	@echo -e "\033[0;36m  ─────────────────────────────────────────\033[0m"
	@$(MYSQL) -e "SELECT SUBSTRING(id,1,20) AS 'ID', first_name AS 'First', last_name AS 'Last', email AS 'Email', UPPER(status) AS 'Status', provider AS 'Via', COALESCE(last_login,'Never') AS 'Last Login' FROM users ORDER BY registered_at DESC;"
	@echo ""
	@echo -e "\033[0;35m\033[1m  📋  APPROVAL LOG\033[0m"
	@echo -e "\033[0;35m  ─────────────────────────────────────────\033[0m"
	@$(MYSQL) -e "SELECT l.id AS '#', u.first_name AS 'Name', u.email AS 'Email', UPPER(l.action) AS 'Action', l.admin_note AS 'Note', l.actioned_at AS 'Time' FROM approval_log l LEFT JOIN users u ON l.user_id=u.id ORDER BY l.actioned_at DESC;"
	@echo ""
	@echo -e "\033[0;32m  ✓  Live data from: $(DB_NAME) @ $(DB_HOST):$(DB_PORT)\033[0m"
	@echo -e "\033[0;32m  Run 'make db' again anytime to refresh\033[0m"
	@echo ""

.PHONY: stop
stop:
	@pkill -f tihanfly_server && echo -e "\033[0;32m✓  Server stopped\033[0m" || echo "Server not running"

.PHONY: clean
clean:
	@rm -rf $(BUILD)
	@echo -e "\033[0;32m✓  Build directory removed\033[0m"