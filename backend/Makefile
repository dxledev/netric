# =========================
# Backend Makefile
# =========================

VENV=venv
PYTHON=$(VENV)/bin/python
PIP=$(VENV)/bin/pip
UVICORN=$(VENV)/bin/uvicorn

APP=main:app
HOST=0.0.0.0
PORT=8000

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
	nohup $(UVICORN) $(APP) --reload --host $(HOST) --port $(PORT) &

# -------------------------
# Reload server (restart dev server)
# -------------------------
reload:
	-pkill -f "$(UVICORN) $(APP) --reload --host $(HOST) --port $(PORT)"
	nohup $(UVICORN) $(APP) --reload --host $(HOST) --port $(PORT) &

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
