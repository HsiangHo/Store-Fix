const extensionApi = globalThis.browser ?? globalThis.chrome;
const {
    DEFAULT_SETTINGS,
    normalizeSettings,
    rewriteAppStoreUrl,
    shouldBypassAutoRedirect
} = globalThis.StoreFixUrl;

let currentSettings = DEFAULT_SETTINGS;

function rewriteHref(rawUrl) {
    if (!currentSettings.enabled)
        return null;

    if (shouldBypassAutoRedirect(rawUrl, currentSettings))
        return null;

    return rewriteAppStoreUrl(rawUrl, currentSettings, document.baseURI);
}

function rewriteAnchor(anchor) {
    const rewrittenUrl = rewriteHref(anchor.href);

    if (rewrittenUrl && anchor.href !== rewrittenUrl)
        anchor.href = rewrittenUrl;
}

function redirectCurrentPage() {
    if (window.top !== window)
        return false;

    const rewrittenUrl = rewriteHref(window.location.href);

    if (!rewrittenUrl || rewrittenUrl === window.location.href)
        return false;

    window.location.replace(rewrittenUrl);
    return true;
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

function handlePossibleNavigation(event) {
    const anchor = getEventAnchor(event);

    if (anchor)
        rewriteAnchor(anchor);
}

async function loadSettings() {
    const storedSettings = await extensionApi.storage.local.get(DEFAULT_SETTINGS);
    currentSettings = normalizeSettings(storedSettings);
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

loadSettings().then(() => {
    if (redirectCurrentPage())
        return;

    observeLinks();
}).catch((error) => {
    console.error("Store Fix failed to load settings:", error);
    observeLinks();
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.keys(changes).some((key) => key in DEFAULT_SETTINGS))
        return;

    loadSettings().then(() => {
        if (redirectCurrentPage())
            return;

        rewriteAnchors();
    }).catch((error) => {
        console.error("Store Fix failed to reload settings:", error);
    });
});
