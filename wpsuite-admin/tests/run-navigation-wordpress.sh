#!/usr/bin/env bash
# Offline, disposable WordPress/MariaDB integration. No installed site is used.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WP_ARCHIVE="${WP_ARCHIVE:-${HOME}/.wp-cli/cache/core/wordpress-7.1-en_US.tar.gz}"
PHP_BIN="${PHP_BIN:-php}"
[[ -r "${WP_ARCHIVE}" ]] || { echo "Missing cached WordPress archive: ${WP_ARCHIVE}" >&2; exit 66; }
TEST_ROOT="$(mktemp -d /tmp/wpsuite-navigation.XXXXXX)"
DB_ROOT="${TEST_ROOT}/mariadb"
DB_SOCKET="${TEST_ROOT}/mariadb.sock"
DB_PID="${TEST_ROOT}/mariadb.pid"
DB_LOG="${TEST_ROOT}/mariadb.log"
WP_ROOT="${TEST_ROOT}/wordpress"
cleanup() {
    local status=$?
    if ((status != 0)) && [[ -f "${DB_LOG}" ]]; then tail -40 "${DB_LOG}" >&2; fi
    if [[ -s "${DB_PID}" ]]; then
        kill "$(<"${DB_PID}")" 2>/dev/null || true
        wait "$(<"${DB_PID}")" 2>/dev/null || true
    fi
    case "${TEST_ROOT}" in /tmp/wpsuite-navigation.*) rm -rf -- "${TEST_ROOT}" ;; esac
}
trap cleanup EXIT
mkdir -p "${DB_ROOT}"
mariadb-install-db --no-defaults --datadir="${DB_ROOT}" --auth-root-authentication-method=normal --skip-test-db >"${TEST_ROOT}/install.log" 2>&1
mariadbd --no-defaults --datadir="${DB_ROOT}" --socket="${DB_SOCKET}" --pid-file="${DB_PID}" --skip-networking --innodb-use-native-aio=0 --log-error="${DB_LOG}" &
for _attempt in {1..100}; do
    if mysqladmin --protocol=SOCKET --socket="${DB_SOCKET}" -uroot ping >/dev/null 2>&1; then break; fi
    sleep 0.1
done
mysqladmin --protocol=SOCKET --socket="${DB_SOCKET}" -uroot ping >/dev/null
mysql --protocol=SOCKET --socket="${DB_SOCKET}" -uroot -e 'CREATE DATABASE navigation_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
tar -xzf "${WP_ARCHIVE}" -C "${TEST_ROOT}"
cat >"${WP_ROOT}/wp-config.php" <<PHP
<?php
define('DB_NAME', 'navigation_test');
define('DB_USER', 'root');
define('DB_PASSWORD', '');
define('DB_HOST', 'localhost:${DB_SOCKET}');
define('DB_CHARSET', 'utf8mb4');
define('WP_HOME', 'http://navigation.test');
define('WP_SITEURL', 'http://navigation.test');
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true);
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', true);
if (getenv('NAV_MULTISITE') === '1') {
    define('MULTISITE', true);
    define('SUBDOMAIN_INSTALL', false);
    define('DOMAIN_CURRENT_SITE', 'navigation.test');
    define('PATH_CURRENT_SITE', '/');
    define('SITE_ID_CURRENT_SITE', 1);
    define('BLOG_ID_CURRENT_SITE', 1);
}
\$table_prefix = 'nav_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
PHP
mkdir -p "${WP_ROOT}/wp-content/mu-plugins"
cat >"${WP_ROOT}/wp-content/mu-plugins/offline.php" <<'PHP'
<?php
add_filter('pre_http_request', static fn() => new WP_Error('offline_test', 'Integration tests cannot make HTTP requests.'));
add_filter('pre_wp_mail', '__return_true');
PHP
"${PHP_BIN}" "${SCRIPT_DIR}/navigation-wordpress.php" "${WP_ROOT}" install
result=0
for role in administrator editor composer reviewer subscriber old-ai-kit future-ai-kit; do
    "${PHP_BIN}" "${SCRIPT_DIR}/navigation-wordpress.php" "${WP_ROOT}" "${role}" || result=1
done
"${PHP_BIN}" "${SCRIPT_DIR}/navigation-wordpress.php" "${WP_ROOT}" network-install
for role in site-administrator super-administrator; do
    NAV_MULTISITE=1 "${PHP_BIN}" "${SCRIPT_DIR}/navigation-wordpress.php" "${WP_ROOT}" "${role}" || result=1
done
((result == 0)) || exit "$result"
echo 'Offline WordPress navigation integration passed.'
