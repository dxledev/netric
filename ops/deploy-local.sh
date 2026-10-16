#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

usage() {
    cat <<'EOF'
Usage:
  ./ops/deploy-local.sh [domain]

Builds Netric, installs Nginx, and configures the backend and refresh timer as
systemd services. Run this from the normal deployment account; the script asks
for sudo only after the unprivileged build succeeds.
EOF
}

validate_domain() {
    local domain_name="$1"
    if [[ ! "${domain_name}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]; then
        printf 'Invalid domain name: %s\n' "${domain_name}" >&2
        exit 2
    fi
}

escape_sed_replacement() {
    printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

render_template() {
    local source_file="$1"
    local destination_file="$2"
    local domain_name="$3"
    local repo_dir="$4"
    local deploy_user="$5"
    local deploy_group="$6"
    local web_root="$7"
    local backend_dir="${repo_dir}/backend"
    local python_bin="${backend_dir}/venv/bin/python"
    local rendered_file

    rendered_file="$(mktemp)"
    sed \
        -e "s|__NETRIC_DOMAIN__|$(escape_sed_replacement "${domain_name}")|g" \
        -e "s|__NETRIC_WEB_ROOT__|$(escape_sed_replacement "${web_root}")|g" \
        -e "s|__NETRIC_BACKEND_DIR__|$(escape_sed_replacement "${backend_dir}")|g" \
        -e "s|__NETRIC_PYTHON_BIN__|$(escape_sed_replacement "${python_bin}")|g" \
        -e "s|__NETRIC_USER__|$(escape_sed_replacement "${deploy_user}")|g" \
        -e "s|__NETRIC_GROUP__|$(escape_sed_replacement "${deploy_group}")|g" \
        "${source_file}" > "${rendered_file}"
    install -m 0644 "${rendered_file}" "${destination_file}"
    rm -f -- "${rendered_file}"
}

stop_repo_dev_backend() {
    local repo_dir="$1"
    local pid_file="${repo_dir}/backend/uvicorn.pid"
    local backend_pid
    local backend_command

    [[ -r "${pid_file}" ]] || return 0
    read -r backend_pid < "${pid_file}"
    [[ "${backend_pid}" =~ ^[0-9]+$ ]] || return 0
    kill -0 "${backend_pid}" 2>/dev/null || return 0

    backend_command="$(tr '\0' ' ' < "/proc/${backend_pid}/cmdline" 2>/dev/null || true)"
    if [[ "${backend_command}" == *uvicorn*main:app* ]]; then
        kill "${backend_pid}"
        for _ in {1..20}; do
            kill -0 "${backend_pid}" 2>/dev/null || break
            sleep 0.25
        done
    fi
}

root_install() {
    local domain_name="$1"
    local repo_dir="$2"
    local deploy_user="$3"
    local deploy_group="$4"
    local web_root="/var/www/netric"

    validate_domain "${domain_name}"
    [[ "${EUID}" -eq 0 ]] || { printf 'Root installation must run with sudo.\n' >&2; exit 1; }
    [[ -f "${repo_dir}/frontend/dist/index.html" ]] || { printf 'Frontend build is missing.\n' >&2; exit 1; }
    [[ -x "${repo_dir}/backend/venv/bin/python" ]] || { printf 'Backend virtual environment is missing.\n' >&2; exit 1; }
    [[ -f "${repo_dir}/backend/.env" ]] || { printf 'Backend .env is missing.\n' >&2; exit 1; }

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y nginx

    install -d -m 0755 "${web_root}"
    find "${web_root}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    cp -a "${repo_dir}/frontend/dist/." "${web_root}/"
    chown -R root:root "${web_root}"
    find "${web_root}" -type d -exec chmod 0755 {} +
    find "${web_root}" -type f -exec chmod 0644 {} +

    render_template \
        "${repo_dir}/ops/systemd/netric-backend.service" \
        "/etc/systemd/system/netric-backend.service" \
        "${domain_name}" "${repo_dir}" "${deploy_user}" "${deploy_group}" "${web_root}"
    render_template \
        "${repo_dir}/ops/systemd/netric-nightly-refresh.service" \
        "/etc/systemd/system/netric-nightly-refresh.service" \
        "${domain_name}" "${repo_dir}" "${deploy_user}" "${deploy_group}" "${web_root}"
    render_template \
        "${repo_dir}/ops/systemd/netric-healthcheck.service" \
        "/etc/systemd/system/netric-healthcheck.service" \
        "${domain_name}" "${repo_dir}" "${deploy_user}" "${deploy_group}" "${web_root}"
    install -m 0644 \
        "${repo_dir}/ops/systemd/netric-nightly-refresh.timer" \
        "/etc/systemd/system/netric-nightly-refresh.timer"
    install -m 0644 \
        "${repo_dir}/ops/systemd/netric-healthcheck.timer" \
        "/etc/systemd/system/netric-healthcheck.timer"
    install -d -m 0755 /usr/local/libexec
    install -d -m 0755 /usr/local/bin
    install -m 0755 \
        "${repo_dir}/ops/netric-healthcheck.sh" \
        "/usr/local/libexec/netric-healthcheck"
    install -m 0755 "${repo_dir}/ops/netricctl" /usr/local/bin/netricctl
    render_template \
        "${repo_dir}/ops/nginx/netric.conf" \
        "/etc/nginx/sites-available/netric" \
        "${domain_name}" "${repo_dir}" "${deploy_user}" "${deploy_group}" "${web_root}"
    install -D -m 0644 "${repo_dir}/ops/nginx/netric-html-cache.conf" \
        /etc/nginx/snippets/netric-html-cache.conf

    ln -sfn /etc/nginx/sites-available/netric /etc/nginx/sites-enabled/netric
    if [[ -L /etc/nginx/sites-enabled/default ]]; then
        rm -f -- /etc/nginx/sites-enabled/default
    fi

    stop_repo_dev_backend "${repo_dir}"
    rm -f -- "${repo_dir}/backend/uvicorn.pid"

    systemctl daemon-reload
    systemctl enable --now mongod.service
    systemctl enable netric-backend.service
    systemctl restart netric-backend.service
    systemctl enable --now netric-nightly-refresh.timer
    nginx -t
    systemctl enable --now nginx.service
    systemctl reload nginx.service

    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
        ufw allow 'Nginx Full'
    fi

    curl --fail --silent --show-error --retry 20 --retry-delay 1 \
        http://127.0.0.1:8000/openapi.json >/dev/null
    curl --fail --silent --show-error --retry 10 --retry-delay 1 \
        --header "Host: ${domain_name}" http://127.0.0.1/api/openapi.json >/dev/null
    curl --fail --silent --show-error \
        --header "Host: ${domain_name}" http://127.0.0.1/ >/dev/null
    systemctl enable --now netric-healthcheck.timer
    systemctl start netric-healthcheck.service

    printf '\nNetric is healthy through Nginx on this machine.\n'
    printf 'Local URL: http://127.0.0.1\n'
    printf 'LAN URL:   http://%s\n' "$(hostname -I | awk '{print $1}')"
    printf 'Domain:    http://%s (after DNS and router forwarding)\n' "${domain_name}"
    printf 'Control:   netricctl on|off|toggle|status|restart|logs\n'
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

if [[ "${1:-}" == "--root-install" ]]; then
    [[ "$#" -eq 5 ]] || { usage >&2; exit 2; }
    root_install "$2" "$3" "$4" "$5"
    exit 0
fi

[[ "$#" -le 1 ]] || { usage >&2; exit 2; }
readonly DOMAIN_NAME="${1:-netricsports.us}"
readonly REPO_DIR="${DEFAULT_REPO_DIR}"
readonly DEPLOY_USER="$(stat -c '%U' "${REPO_DIR}")"
readonly DEPLOY_GROUP="$(stat -c '%G' "${REPO_DIR}")"

validate_domain "${DOMAIN_NAME}"
[[ "${EUID}" -ne 0 ]] || { printf 'Run this as the deployment user, not directly as root.\n' >&2; exit 1; }
[[ -f "${REPO_DIR}/backend/.env" ]] || { printf 'backend/.env is required.\n' >&2; exit 1; }
[[ -x "${REPO_DIR}/backend/venv/bin/python" ]] || {
    printf 'Backend venv is missing. Run: (cd backend && make setup)\n' >&2
    exit 1
}

printf 'Building frontend for %s...\n' "${DOMAIN_NAME}"
(cd "${REPO_DIR}/frontend" && npm run build)
(cd "${REPO_DIR}/backend" && venv/bin/python -m py_compile main.py database.py auth.py nba.py services/*.py)
chmod 0600 "${REPO_DIR}/backend/.env"

printf '\nBuild passed. Administrator access is now required to install Nginx and services.\n'
exec sudo -- "${BASH_SOURCE[0]}" --root-install \
    "${DOMAIN_NAME}" "${REPO_DIR}" "${DEPLOY_USER}" "${DEPLOY_GROUP}"
