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
	@echo "  make reload   - Restart dev server"
	@echo "  make prod     - Run production server"
	@echo "  make freeze   - Save requirements.txt"
	@echo "  make clean    - Remove virtual environment"
