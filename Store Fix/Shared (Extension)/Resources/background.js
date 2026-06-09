const extensionApi = globalThis.browser ?? globalThis.chrome;
const {
    DEFAULT_SETTINGS,
    getForcedAppStoreUrl,
    normalizeSettings,
    rewriteAppStoreUrl,
    sanitizeRegion,
    shouldBypassAutoRedirect
} = globalThis.StoreFixUrl;

let currentSettings = DEFAULT_SETTINGS;
let settingsReady = refreshSettings();

async function refreshSettings() {
    const storedSettings = await extensionApi.storage.local.get(DEFAULT_SETTINGS);
    currentSettings = normalizeSettings(storedSettings);
    return currentSettings;
}

async function getRedirectUrl(url) {
    await settingsReady;

    if (!currentSettings.enabled)
        return null;

    if (shouldBypassAutoRedirect(url, currentSettings))
        return null;

    return rewriteAppStoreUrl(url, currentSettings);
}

function getForceOpenUrl(targetUrl) {
    return extensionApi.runtime.getURL(`force-open.html?url=${encodeURIComponent(targetUrl)}`);
}

async function getNavigationRedirectUrl(url) {
    await settingsReady;

    if (!currentSettings.enabled)
        return null;

    if (shouldBypassAutoRedirect(url, currentSettings))
        return null;

    if (currentSettings.forceOpenMode !== "off") {
        const targetUrl = getForcedAppStoreUrl(url, currentSettings);

        if (!targetUrl)
            return null;

        await setManualJumpBypass(targetUrl);
        return getForceOpenUrl(targetUrl);
    }

    return rewriteAppStoreUrl(url, currentSettings);
}

async function redirectTab(tabId, url) {
    if (typeof tabId !== "number" || tabId < 0)
        return { changed: false };

    const redirectUrl = await getNavigationRedirectUrl(url);

    if (!redirectUrl || redirectUrl === url)
        return { changed: false };

    await extensionApi.tabs.update(tabId, { url: redirectUrl });
    return { changed: true, url: redirectUrl };
}

async function fixCurrentTab() {
    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (typeof activeTab?.id !== "number" || !activeTab.url)
        return { changed: false };

    return redirectTab(activeTab.id, activeTab.url);
}

async function setManualJumpBypass(url, region = "") {
    await extensionApi.storage.local.set({
        manualJumpUrl: url,
        manualJumpRegion: sanitizeRegion(region),
        manualJumpExpiresAt: Date.now() + 15000
    });

    settingsReady = refreshSettings();
    await settingsReady;
}

async function openQuickJump(region, openMode) {
    const targetRegion = sanitizeRegion(region);

    if (!targetRegion)
        return { changed: false };

    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (typeof activeTab?.id !== "number" || !activeTab.url)
        return { changed: false };

    const targetUrl = rewriteAppStoreUrl(activeTab.url, {
        ...currentSettings,
        enabled: true,
        mode: "preset",
        region: targetRegion,
        customRegion: ""
    });

    if (!targetUrl)
        return { changed: false };

    await setManualJumpBypass(targetUrl, targetRegion);

    const openUrl = currentSettings.forceOpenMode === "off"
        ? targetUrl
        : getForceOpenUrl(targetUrl);

    if (openMode === "new-tab") {
        const newTab = await extensionApi.tabs.create({
            active: true,
            index: activeTab.index + 1,
            url: openUrl
        });

        return { changed: true, tabId: newTab.id, url: targetUrl };
    }

    await extensionApi.tabs.update(activeTab.id, { url: openUrl });
    return { changed: true, tabId: activeTab.id, url: targetUrl };
}

async function openForcedAppStoreLink(url) {
    await settingsReady;

    if (!currentSettings.enabled || currentSettings.forceOpenMode === "off")
        return { changed: false };

    const targetUrl = getForcedAppStoreUrl(url, currentSettings);

    if (!targetUrl)
        return { changed: false };

    await setManualJumpBypass(targetUrl);

    const forceOpenUrl = getForceOpenUrl(targetUrl);

    if (currentSettings.forceOpenMode === "new-window" && extensionApi.windows?.create) {
        try {
            const createdWindow = await extensionApi.windows.create({
                focused: true,
                type: "normal",
                url: forceOpenUrl
            });

            return { changed: true, windowId: createdWindow?.id, url: targetUrl };
        } catch (error) {
            console.warn("Store Fix could not open a new window; falling back to a new tab:", error);
        }
    }

    const createdTab = await extensionApi.tabs.create({
        active: true,
        url: forceOpenUrl
    });

    return { changed: true, tabId: createdTab.id, url: targetUrl };
}

extensionApi.runtime.onInstalled.addListener(() => {
    settingsReady = refreshSettings();
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.keys(changes).some((key) => key in DEFAULT_SETTINGS))
        settingsReady = refreshSettings();
});

if (extensionApi.webNavigation?.onBeforeNavigate) {
    extensionApi.webNavigation.onBeforeNavigate.addListener((details) => {
        if (details.frameId !== 0)
            return;

        redirectTab(details.tabId, details.url).catch((error) => {
            console.error("Store Fix redirect failed:", error);
        });
    }, {
        url: [{
            hostEquals: "apps.apple.com",
            schemes: [ "http", "https" ]
        }]
    });
}

extensionApi.runtime.onMessage.addListener((request) => {
    if (request?.type === "store-fix-normalize-url")
        return getRedirectUrl(request.url).then((url) => ({ url }));

    if (request?.type === "store-fix-fix-current-tab")
        return fixCurrentTab();

    if (request?.type === "store-fix-open-quick-jump")
        return openQuickJump(request.region, request.openMode);

    if (request?.type === "store-fix-open-forced-window")
        return openForcedAppStoreLink(request.url);

    return undefined;
});
