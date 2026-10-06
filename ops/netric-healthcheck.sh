#!/usr/bin/env bash

set -Eeuo pipefail

readonly DOMAIN_NAME="${1:-netricsports.us}"
readonly BACKEND_URL="http://127.0.0.1:8000/openapi.json"
readonly NGINX_FRONTEND_URL="http://127.0.0.1/"
readonly NGINX_API_URL="http://127.0.0.1/api/openapi.json"

log() {
    printf 'netric-healthcheck: %s\n' "$*"
}

ensure_active() {
    local unit_name="$1"

    if systemctl is-active --quiet "${unit_name}"; then
        return 0
    fi

    log "${unit_name} is stopped; starting it"
    systemctl start "${unit_name}"
}

http_healthy() {
    local url="$1"
    shift
    curl --fail --silent --show-error --max-time 15 "$@" "${url}" >/dev/null
}

ensure_active mongod.service
ensure_active netric-backend.service

if ! http_healthy "${BACKEND_URL}"; then
    log "backend health check failed; restarting netric-backend.service"
    systemctl restart netric-backend.service
    sleep 3
    if ! http_healthy "${BACKEND_URL}"; then
        log "backend is still unhealthy after restart"
        exit 1
    fi
fi

ensure_active nginx.service

if ! http_healthy "${NGINX_FRONTEND_URL}" --header "Host: ${DOMAIN_NAME}"; then
    log "Nginx frontend check failed; validating configuration and restarting Nginx"
    nginx -t
    systemctl restart nginx.service
    sleep 2
fi

if ! http_healthy "${NGINX_FRONTEND_URL}" --header "Host: ${DOMAIN_NAME}"; then
    log "frontend is still unhealthy after Nginx restart"
    exit 1
fi

if ! http_healthy "${NGINX_API_URL}" --header "Host: ${DOMAIN_NAME}"; then
    log "Nginx API proxy check failed; restarting backend and Nginx"
    systemctl restart netric-backend.service nginx.service
    sleep 3
fi

if ! http_healthy "${NGINX_API_URL}" --header "Host: ${DOMAIN_NAME}"; then
    log "API proxy is still unhealthy after restart"
    exit 1
fi

log "frontend, API proxy, backend, MongoDB, and Nginx are healthy"
