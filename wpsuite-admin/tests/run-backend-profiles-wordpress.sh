#!/usr/bin/env bash
# Offline, disposable WordPress/MariaDB integration. No installed site is used.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WP_ARCHIVE="${WP_ARCHIVE:-${HOME}/.wp-cli/cache/core/wordpress-7.1-en_US.tar.gz}"
PHP_BIN="${PHP_BIN:-php}"
[[ -r "${WP_ARCHIVE}" ]] || { echo "Missing cached WordPress archive: ${WP_ARCHIVE}" >&2; exit 66; }
TEST_ROOT="$(mktemp -d /tmp/wpsuite-backend-profiles.XXXXXX)"
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
    case "${TEST_ROOT}" in /tmp/wpsuite-backend-profiles.*) rm -rf -- "${TEST_ROOT}" ;; esac
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
require_once '${SCRIPT_DIR}/site-key-storage-fixture.php';
define('DB_NAME', 'navigation_test');
define('DB_USER', 'root');
define('DB_PASSWORD', '');
define('DB_HOST', 'localhost:${DB_SOCKET}');
define('DB_CHARSET', 'utf8mb4');
define('WP_HOME', 'https://dev.wpsuite.io');
define('WP_SITEURL', 'https://dev.wpsuite.io');
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true);
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', true);
if (getenv('NAV_MULTISITE') === '1') {
    define('MULTISITE', true);
    define('SUBDOMAIN_INSTALL', false);
    define('DOMAIN_CURRENT_SITE', 'dev.wpsuite.io');
    define('PATH_CURRENT_SITE', '/');
    define('SITE_ID_CURRENT_SITE', 1);
    define('BLOG_ID_CURRENT_SITE', 1);
}
\$table_prefix = getenv('WPSUITE_PROFILE_PACKAGE_RUN') === '1' ? 'package_' : 'nav_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
PHP
mkdir -p "${WP_ROOT}/wp-content/mu-plugins"
cat >"${WP_ROOT}/wp-content/mu-plugins/offline.php" <<'PHP'
<?php
add_filter('pre_http_request', static fn() => new WP_Error('offline_test', 'Integration tests cannot make HTTP requests.'));
add_filter('pre_wp_mail', '__return_true');
PHP
"${PHP_BIN}" "${SCRIPT_DIR}/backend-profiles-wordpress.php" "${WP_ROOT}" install
"${PHP_BIN}" "${SCRIPT_DIR}/backend-profiles-wordpress.php" "${WP_ROOT}" test
"${PHP_BIN}" "${SCRIPT_DIR}/../../../ai-kit/tests/knowledge-sync-sql-prepare.test.php" "${WP_ROOT}"
if [[ "${WPSUITE_PROFILE_PACKAGE_SMOKE:-0}" == "1" ]]; then
    SOURCE_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
    python3 - "${SOURCE_ROOT}" "${WP_ROOT}" "${TEST_ROOT}/packaged-manifest.json" <<'PYSMOKE'
import hashlib, json, pathlib, shutil, stat, sys, zipfile
source, wp, output = map(pathlib.Path, sys.argv[1:])
assert wp.parent.name.startswith('wpsuite-backend-profiles.') and str(wp.parent.parent) == '/tmp'
family = source / 'smartcloud-agent-ready-product-family/wpsuite-plugins'
canonical = json.loads((family / 'release-manifest.json').read_text())['packages']
assert {item['slug'] for item in canonical} == {'gatey', 'smartcloud-ai-kit', 'smartcloud-flow', 'smartcloud-static-publisher', 'smartcloud-agent-composer'}
packages = [(family, item, item['zip_checksum']) for item in canonical]
for name in ['consent', 'content-relations']:
    directory = source / 'wpsuite-private-plugins' / name
    item = json.loads((directory / 'dist/release-manifest.json').read_text())['plugin']
    packages.append((directory, item, item['zipChecksum']))
plugins = wp / 'wp-content/plugins'
shutil.rmtree(plugins)
plugins.mkdir()
result = []
for directory, item, expected_zip in packages:
    slug = item['slug']
    archive = directory / item['zip']
    checksum = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
    assert checksum == expected_zip, f'Final ZIP checksum mismatch: {slug}'
    expected_files = {slug + '/' + key: value for key, value in item['files'].items()}
    with zipfile.ZipFile(archive) as zipped:
        files = [info for info in zipped.infolist() if not info.is_dir()]
        assert len(files) == len(expected_files) and {info.filename for info in files} == set(expected_files), f'ZIP manifest differs: {slug}'
        for info in files:
            name = pathlib.PurePosixPath(info.filename)
            assert not name.is_absolute() and '..' not in name.parts and name.parts[0] == slug
            assert not stat.S_ISLNK(info.external_attr >> 16), f'Source alias in ZIP: {slug}'
            data = zipped.read(info)
            assert 'sha256:' + hashlib.sha256(data).hexdigest() == expected_files[info.filename], f'Packaged file checksum mismatch: {info.filename}'
            target = plugins.joinpath(*name.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    entry = slug + '/' + ('gatey.php' if slug == 'gatey' else slug + '.php')
    assert (plugins / entry).is_file(), f'Packaged main entry missing: {slug}'
    result.append({'slug': slug, 'version': item['version'], 'entry': entry, 'zipChecksum': checksum, 'files': len(expected_files)})
output.write_text(json.dumps(result, indent=2) + '\n')
print('Extracted and verified final ZIP cohort:', ', '.join(item['slug'] + '@' + item['version'] for item in result))
print('Packaged files verified:', sum(item['files'] for item in result))
print('Packaged cohort manifest:', json.dumps(result, separators=(',', ':')))
PYSMOKE
    for scenario in install activate frontend admin; do
        WPSUITE_PROFILE_PACKAGE_RUN=1 "${PHP_BIN}" "${SCRIPT_DIR}/packaged-plugins-wordpress.php" "${WP_ROOT}" "${scenario}" "${TEST_ROOT}/packaged-manifest.json"
    done
fi
echo 'Offline backend profile WordPress/MariaDB integration passed.' 
