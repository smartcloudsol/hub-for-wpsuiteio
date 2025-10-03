<?php
/**
 * Admin class to create settings page and  REST API endpoint to handle parameter updates coming from the settings front-end,
 * and load the settings.
 *
 */
namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
class SiteSettings
{
    public function __construct(
        public string $accountId = "",
        public string $siteId = "",
        public int $lastUpdate = 0,
        public bool $subscriber = false,
        public string $siteKey = "",
    ) {
    }
}
