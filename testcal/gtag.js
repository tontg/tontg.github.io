/* global dataLayer */

// Google Analytics
window.dataLayer = window.dataLayer || [];
function gtag() {
    dataLayer.push(arguments);
}
gtag('js', new Date());
/*gtag('set', {
    cookie_domain: 'tontg.github.io',
    cookie_flags: 'SameSite=None;Secure'
});*/
// gtag('config', 'G-SY0XX3MBF7');
gtag('config', 'G-SY0XX3MBF7', {
    cookie_domain: 'tontg.github.io',
    cookie_flags: 'SameSite=None;Secure'
});