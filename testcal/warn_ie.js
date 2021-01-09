/**
 * this website uses ECMAScript 6 which is not supported by legacy versions of the Internet Explorer browser
 **/
function internetExplorerMessage() {
    if (window.navigator.userAgent.indexOf('MSIE') > 0 || window.navigator.userAgent.indexOf('Trident/') > 0) {
        document.write("<p>&#x26A0;&#xFE0F; This website uses recent features that are not supported by legacy versions of the Internet Explorer browser.</p>");
    }
}