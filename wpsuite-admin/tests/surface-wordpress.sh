#!/usr/bin/env bash
# Actual packaged plugins with a test-only PHP overlay, in disposable offline WP.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
WP_ARCHIVE="${WP_ARCHIVE:-${HOME}/.wp-cli/cache/core/wordpress-7.1-en_US.tar.gz}"
PHP_BIN="${PHP_BIN:-php}"
TEST_ROOT="$(mktemp -d /tmp/wpsuite-surfaces.XXXXXX)"
DB_ROOT="${TEST_ROOT}/mariadb"
DB_SOCKET="${TEST_ROOT}/mariadb.sock"
DB_PID="${TEST_ROOT}/mariadb.pid"
DB_LOG="${TEST_ROOT}/mariadb.log"
WP_ROOT="${TEST_ROOT}/wordpress"
cleanup() {
    local status=$?
    if ((status != 0)) && [[ -f "${DB_LOG}" ]]; then tail -15 "${DB_LOG}" >&2; fi
    if [[ -s "${DB_PID}" ]]; then
        kill "$(<"${DB_PID}")" 2>/dev/null || true
        wait "$(<"${DB_PID}")" 2>/dev/null || true
    fi
    case "${TEST_ROOT}" in /tmp/wpsuite-surfaces.*) rm -rf -- "${TEST_ROOT}" ;; esac
}
trap cleanup EXIT
[[ -r "${WP_ARCHIVE}" ]] || { echo 'Cached WordPress archive required.' >&2; exit 66; }
mkdir -p "${DB_ROOT}"
mariadb-install-db --no-defaults --datadir="${DB_ROOT}" --auth-root-authentication-method=normal --skip-test-db >"${TEST_ROOT}/install.log" 2>&1
mariadbd --no-defaults --datadir="${DB_ROOT}" --socket="${DB_SOCKET}" --pid-file="${DB_PID}" --skip-networking --innodb-use-native-aio=0 --log-error="${DB_LOG}" &
for _attempt in {1..100}; do
    if mysqladmin --protocol=SOCKET --socket="${DB_SOCKET}" -uroot ping >/dev/null 2>&1; then break; fi
    sleep 0.1
done
mysqladmin --protocol=SOCKET --socket="${DB_SOCKET}" -uroot ping >/dev/null
mysql --protocol=SOCKET --socket="${DB_SOCKET}" -uroot -e 'CREATE DATABASE surface_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
tar -xzf "${WP_ARCHIVE}" -C "${TEST_ROOT}"
cat >"${WP_ROOT}/wp-config.php" <<PHP
<?php
define('DB_NAME', 'surface_test');
define('DB_USER', 'root');
define('DB_PASSWORD', '');
define('DB_HOST', 'localhost:${DB_SOCKET}');
define('DB_CHARSET', 'utf8mb4');
define('WP_HOME', 'http://surfaces.test');
define('WP_SITEURL', 'http://surfaces.test');
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true);
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', true);
\$table_prefix = 'surface_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
PHP
mkdir -p "${WP_ROOT}/wp-content/mu-plugins"
cat >"${WP_ROOT}/wp-content/mu-plugins/offline.php" <<'PHP'
<?php
add_filter('pre_http_request', static fn() => new WP_Error('offline_test', 'Integration tests cannot make HTTP requests.'));
add_filter('pre_wp_mail', '__return_true');
PHP
python3 "${SCRIPT_DIR}/surface-wordpress-overlay.py" "${REPO_ROOT}" "${WP_ROOT}"
"${PHP_BIN}" "${SCRIPT_DIR}/surface-wordpress.php" "${WP_ROOT}" install
"${PHP_BIN}" "${SCRIPT_DIR}/surface-wordpress.php" "${WP_ROOT}" test
echo 'Offline full-plugin surface integration passed.'
