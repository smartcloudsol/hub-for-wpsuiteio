<?php
/** Public synthetic test constants only; never use production configuration in tests. */
foreach (array('AUTH_KEY', 'SECURE_AUTH_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT') as $fixtureName) {
    if (!defined($fixtureName)) define($fixtureName, 'synthetic-only-' . $fixtureName . '-abcdefghijklmnopqrstuvwxyz-' . hash('sha512', $fixtureName . ($GLOBALS['fixture_key_rotation'] ?? '')));
}
unset($fixtureName);
