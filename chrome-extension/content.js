const extensionApi = globalThis.browser ?? globalThis.chrome;
const {
    DEFAULT_SETTINGS,
    getForcedAppStoreUrl,
    isAppStoreDeepLinkUrl,
    normalizeSettings,
    rewriteAppStoreUrl,
    shouldBypassAutoRedirect
} = globalThis.StoreFixUrl;

let currentSettings = DEFAULT_SETTINGS;
let canKeepAppStoreLinksInBrowser = !isIOSPlatform();

function isIOSPlatform() {
    return /\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function canUseForceOpenMode() {
    return currentSettings.forceOpenMode !== "off" && canKeepAppStoreLinksInBrowser;
}

function rewriteHref(rawUrl) {
    if (!currentSettings.enabled)
        return null;

    if (shouldBypassAutoRedirect(rawUrl, currentSettings))
        return null;

    return rewriteAppStoreUrl(rawUrl, currentSettings, document.baseURI);
}

function getForcedHref(rawUrl) {
    if (!currentSettings.enabled || !canUseForceOpenMode())
        return null;

    if (isAppStoreDeepLinkUrl(rawUrl, document.baseURI))
        return null;

    return getForcedAppStoreUrl(rawUrl, currentSettings, document.baseURI);
}

function rewriteAnchor(anchor) {
    const rewrittenUrl = rewriteHref(anchor.href);

    if (rewrittenUrl && anchor.href !== rewrittenUrl)
        anchor.href = rewrittenUrl;
}

async function redirectCurrentPage() {
    if (window.top !== window)
        return false;

    const rewrittenUrl = rewriteHref(window.location.href);
    const forcedUrl = getForcedHref(window.location.href);

    if ((!rewrittenUrl || rewrittenUrl === window.location.href) && !forcedUrl)
        return false;

    try {
        const response = await extensionApi.runtime.sendMessage({
            type: "store-fix-redirect-current-page",
            url: window.location.href
        });

        return response?.changed === true;
    } catch (error) {
        console.error("Store Fix failed to redirect the current page:", error);
        return false;
    }
}

function rewriteAnchors(root = document) {
    if (root instanceof HTMLAnchorElement)
        rewriteAnchor(root);

    if (root.querySelectorAll)
        root.querySelectorAll("a[href]").forEach(rewriteAnchor);
}

function getEventAnchor(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    return target?.closest?.("a[href]") ?? null;
}

function shouldForceOpen(event) {
    return canUseForceOpenMode() && (event.type === "click" || event.type === "auxclick");
}

function openForcedAppStoreLink(url) {
    extensionApi.runtime.sendMessage({
        type: "store-fix-open-forced-window",
        url
    }).catch((error) => {
        console.error("Store Fix failed to force-open App Store link in the browser:", error);
    });
}

function handlePossibleNavigation(event) {
    const anchor = getEventAnchor(event);

    if (!anchor)
        return;

    const rewrittenUrl = rewriteHref(anchor.href);
    const forcedUrl = getForcedHref(anchor.href);

    if (!rewrittenUrl && !forcedUrl)
        return;

    if (shouldForceOpen(event) && forcedUrl) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openForcedAppStoreLink(forcedUrl);
        return;
    }

    if (forcedUrl && anchor.href !== forcedUrl) {
        anchor.href = forcedUrl;
        return;
    }

    if (rewrittenUrl && anchor.href !== rewrittenUrl)
        anchor.href = rewrittenUrl;
}

async function loadSettings() {
    const storedSettings = await extensionApi.storage.local.get(DEFAULT_SETTINGS);
    currentSettings = normalizeSettings(storedSettings);

    try {
        const capabilities = await extensionApi.runtime.sendMessage({
            type: "store-fix-get-capabilities"
        });

        if (typeof capabilities?.canKeepAppStoreLinksInBrowser === "boolean")
            canKeepAppStoreLinksInBrowser = capabilities.canKeepAppStoreLinksInBrowser;
    } catch (error) {
        canKeepAppStoreLinksInBrowser = !isIOSPlatform();
        console.warn("Store Fix could not load extension capabilities:", error);
    }
}

function observeLinks() {
    if (!document.documentElement) {
        setTimeout(observeLinks, 0);
        return;
    }

    rewriteAnchors();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.target instanceof HTMLAnchorElement) {
                rewriteAnchor(mutation.target);
                continue;
            }

            mutation.addedNodes.forEach((node) => {
                if (node instanceof Element)
                    rewriteAnchors(node);
            });
        }
    });

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [ "href" ],
        childList: true,
        subtree: true
    });
}

document.addEventListener("click", handlePossibleNavigation, true);
document.addEventListener("auxclick", handlePossibleNavigation, true);
document.addEventListener("mousedown", handlePossibleNavigation, true);

loadSettings().then(async () => {
    if (await redirectCurrentPage())
        return;

    observeLinks();
}).catch((error) => {
    console.error("Store Fix failed to load settings:", error);
    observeLinks();
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.keys(changes).some((key) => key in DEFAULT_SETTINGS))
        return;

    loadSettings().then(async () => {
        if (await redirectCurrentPage())
            return;

        rewriteAnchors();
    }).catch((error) => {
        console.error("Store Fix failed to reload settings:", error);
    });
});
