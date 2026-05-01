# =========================
# Backend Makefile
# =========================

VENV=venv
PYTHON=$(VENV)/bin/python
PIP=$(VENV)/bin/pip
UVICORN=$(VENV)/bin/uvicorn

APP=main:app
HOST=127.0.0.1
PORT=8000
SERVICE=netric-backend.service
HEALTH_URL=http://$(HOST):$(PORT)/openapi.json
PROXY_HEALTH_URL=http://127.0.0.1/api/openapi.json
HEALTH_RETRIES=20
HEALTH_DELAY=1

.PHONY: setup install run reload prod freeze clean help health proxy-health

# -------------------------
# Setup virtual environment
# -------------------------
setup:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

# -------------------------
# Install dependencies
# -------------------------
install:
	$(PIP) install -r requirements.txt

# -------------------------
# Run development server
# -------------------------
run:
	nohup $(UVICORN) $(APP) --host $(HOST) --port $(PORT) > uvicorn.log 2>&1 &

# -------------------------
# Reload server (restart dev server)
# -------------------------
reload:
	@if systemctl list-unit-files "$(SERVICE)" 2>/dev/null | grep -q "^$(SERVICE)"; then \
		sudo systemctl restart "$(SERVICE)"; \
		sudo systemctl --no-pager --lines=20 status "$(SERVICE)"; \
	else \
		pkill -f "$(UVICORN) $(APP)" || true; \
		nohup $(UVICORN) $(APP) --host $(HOST) --port $(PORT) > uvicorn.log 2>&1 & \
	fi
	@$(MAKE) health
	@if systemctl is-active --quiet nginx 2>/dev/null; then \
		$(MAKE) proxy-health; \
	fi

# -------------------------
# Verify backend HTTP health
# -------------------------
health:
	@i=1; \
	while [ $$i -le $(HEALTH_RETRIES) ]; do \
		if curl -fsS "$(HEALTH_URL)" >/dev/null 2>&1; then \
			echo "Backend healthy at $(HEALTH_URL)"; \
			exit 0; \
		fi; \
		sleep $(HEALTH_DELAY); \
		i=$$((i + 1)); \
	done; \
	echo "Backend did not become healthy at $(HEALTH_URL)" >&2; \
	if systemctl list-unit-files "$(SERVICE)" 2>/dev/null | grep -q "^$(SERVICE)"; then \
		sudo journalctl -u "$(SERVICE)" --no-pager -n 80; \
	else \
		tail -n 80 uvicorn.log 2>/dev/null || true; \
	fi; \
	exit 1

# -------------------------
# Verify nginx API proxy when deployed
# -------------------------
proxy-health:
	@curl -fsS "$(PROXY_HEALTH_URL)" >/dev/null || { \
		echo "Nginx API proxy is not healthy at $(PROXY_HEALTH_URL)" >&2; \
		echo "Check /etc/nginx/conf.d/netric.conf has a location /api/ proxy to $(HOST):$(PORT)." >&2; \
		exit 1; \
	}
	@echo "Nginx API proxy healthy at $(PROXY_HEALTH_URL)"

# -------------------------
# Production run (no reload)
# -------------------------
prod:
	$(UVICORN) $(APP) --host $(HOST) --port $(PORT)

# -------------------------
# Freeze dependencies
# -------------------------
freeze:
	$(PIP) freeze > requirements.txt

# -------------------------
# Remove venv
# -------------------------
clean:
	rm -rf $(VENV)

# -------------------------
# Help
# -------------------------
help:
	@echo "Available commands:"
	@echo "  make setup    - Create venv and install deps"
	@echo "  make install  - Install deps"
	@echo "  make run      - Run dev server"
	@echo "  make reload   - Restart server and verify backend/proxy health"
	@echo "  make health   - Verify backend HTTP health"
	@echo "  make proxy-health - Verify nginx /api proxy health"
	@echo "  make prod     - Run production server"
	@echo "  make freeze   - Save requirements.txt"
	@echo "  make clean    - Remove virtual environment"
