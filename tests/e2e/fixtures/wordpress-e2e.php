<?php
/** Local test environment only. Disable the welcome guide and seed synthetic text. */
add_filter('block_editor_settings_all', function ($settings) {
    $settings['welcomeGuide'] = false;
    return $settings;
});
// The local PHP/WASM server has one worker. Do not send it PHP loopback requests.
add_filter('pre_http_request', function ($result, $args, $url) {
    $host = wp_parse_url($url, PHP_URL_HOST);
    return in_array($host, array('localhost', '127.0.0.1'), true)
        ? new WP_Error('fluenttyper_e2e_loopback', 'Loopback requests are disabled in this test site.')
        : $result;
}, 10, 3);
