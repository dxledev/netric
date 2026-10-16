#!/usr/bin/env bash

set -Eeuo pipefail

readonly REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly WEB_ROOT="/var/www/netric"

usage() {
    cat <<'EOF'
Usage: ./rebuild.sh [domain]

Rebuild the frontend, publish it to /var/www/netric, restart the backend,
and reload Nginx. Requires the setup from ops/deploy-local.sh.
Run as your normal user; sudo is requested after the build succeeds.
The domain defaults to netricsports.us and is used for local HTTP checks.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi
[[ "$#" -le 1 ]] || { usage >&2; exit 2; }
readonly DOMAIN_NAME="${1:-netricsports.us}"
[[ "${DOMAIN_NAME}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || {
    printf 'Invalid domain name: %s\n' "${DOMAIN_NAME}" >&2
    exit 2
}
[[ "${EUID}" -ne 0 ]] || { printf 'Run ./rebuild.sh as your normal user, without sudo.\n' >&2; exit 1; }
[[ -x "${REPO_DIR}/backend/venv/bin/python" && -f "${REPO_DIR}/backend/.env" ]] || {
    printf 'Backend venv and backend/.env are required. See ops/README.md for setup.\n' >&2
    exit 1
}

trap 'printf "Rebuild failed at line %s. Check the error above.\n" "$LINENO" >&2' ERR

printf 'Building frontend and checking backend Python syntax...\n'
(cd "${REPO_DIR}/frontend" && npm run build)
[[ -f "${REPO_DIR}/frontend/dist/index.html" ]]
[[ -f "${REPO_DIR}/frontend/dist/version.json" ]]
(cd "${REPO_DIR}/backend" && venv/bin/python -m py_compile main.py database.py auth.py nba.py services/*.py)

printf '\nBuild passed. Checking deployment with sudo...\n'
sudo -v
sudo systemctl cat netric-backend.service >/dev/null
sudo systemctl is-active --quiet nginx.service
sudo install -D -m 0644 -- "${REPO_DIR}/ops/nginx/netric-html-cache.conf" \
    /etc/nginx/snippets/netric-html-cache.conf
sudo "${REPO_DIR}/backend/venv/bin/python" "${REPO_DIR}/ops/configure_frontend_cache.py" \
    /etc/nginx/sites-available/netric
sudo nginx -t
printf 'Activating HTML cache policy before publishing the new release...\n'
sudo systemctl reload nginx.service

printf 'Publishing frontend to %s...\n' "${WEB_ROOT}"
# Keep older hashed assets for browsers with an earlier page open. Publish the
# index after its assets, then the version manifest last. Returning tabs only
# detect the release once the complete frontend is available.
while IFS= read -r -d '' built_file; do
    relative_file="${built_file#"${REPO_DIR}/frontend/dist/"}"
    [[ "${relative_file}" != "index.html" && "${relative_file}" != "version.json" ]] || continue
    sudo install -D -m 0644 -- "${built_file}" "${WEB_ROOT}/${relative_file}"
done < <(find "${REPO_DIR}/frontend/dist" -type f -print0)
sudo install -m 0644 -- "${REPO_DIR}/frontend/dist/index.html" "${WEB_ROOT}/index.html.next"
sudo mv -- "${WEB_ROOT}/index.html.next" "${WEB_ROOT}/index.html"
sudo install -m 0644 -- "${REPO_DIR}/frontend/dist/version.json" "${WEB_ROOT}/version.json.next"
sudo mv -- "${WEB_ROOT}/version.json.next" "${WEB_ROOT}/version.json"

printf 'Restarting backend...\n'
sudo systemctl restart netric-backend.service

printf 'Waiting for backend and checking Nginx routes...\n'
curl --fail --silent --show-error --max-time 5 --retry 30 \
    --retry-connrefused --retry-delay 1 --retry-max-time 120 \
    http://127.0.0.1:8000/openapi.json >/dev/null
curl --fail --silent --show-error --max-time 15 \
    --header "Host: ${DOMAIN_NAME}" http://127.0.0.1/api/openapi.json >/dev/null
curl --fail --silent --show-error --max-time 15 \
    --header "Host: ${DOMAIN_NAME}" http://127.0.0.1/ >/dev/null

printf '\nRebuild complete. Frontend, backend, and Nginx HTTP checks passed.\n'
