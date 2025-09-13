// ES module entry for extension content-script usage.
// Note: Not used by the standalone page; index.html loads app.js instead.
import UIBootstrap from './ui_bootstrap.js';

// Only auto-initialize when running as a browser extension (chrome.runtime present)
if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome && chrome.runtime) {
    try { const uiBootstrap = new UIBootstrap(); uiBootstrap.init(); } catch (e) { /* ignore */ }
}
