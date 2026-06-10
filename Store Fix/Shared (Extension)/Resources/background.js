const extensionApi = globalThis.browser ?? globalThis.chrome;
const {
    DEFAULT_SETTINGS,
    getForcedAppStoreUrl,
    getTargetRegion,
    normalizeSettings,
    rewriteAppStoreUrl,
    sanitizeRegion,
    shouldBypassAutoRedirect
} = globalThis.StoreFixUrl;

let currentSettings = DEFAULT_SETTINGS;
let settingsReady = refreshSettings();
const REDIRECT_LOOP_LIMIT = 3;
const REDIRECT_LOOP_WINDOW_MS = 20000;
const REDIRECT_LOOP_STORAGE_KEY = "redirectLoopAttempts";
const REDIRECT_SUCCESS_CLEAR_DELAY_MS = 6000;
const REDIRECT_INTENT_WINDOW_MS = 45000;
const pendingRedirectClears = new Map();

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

function getForceOpenUrl(targetUrl, shouldRegisterIntent = true) {
    const params = new URLSearchParams({ url: targetUrl });

    if (!shouldRegisterIntent)
        params.set("registerIntent", "0");

    return extensionApi.runtime.getURL(`force-open.html?${params.toString()}`);
}

function parseAppStoreNavigationUrl(rawUrl) {
    let url;

    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    if (url.hostname.toLowerCase() !== "apps.apple.com")
        return null;

    if (url.protocol !== "https:" && url.protocol !== "http:")
        return null;

    return url;
}

function appStoreRegion(rawUrl) {
    const url = parseAppStoreNavigationUrl(rawUrl);
    const firstSegment = url?.pathname.split("/").filter(Boolean)[0] ?? "";
    return sanitizeRegion(firstSegment);
}

function getRegionFailedUrl(sourceUrl, targetUrl) {
    const targetRegion = appStoreRegion(targetUrl) || getTargetRegion(currentSettings);
    const sourceRegion = appStoreRegion(sourceUrl);
    const params = new URLSearchParams({
        targetRegion: targetRegion.toUpperCase(),
        sourceRegion: sourceRegion.toUpperCase(),
        targetUrl
    });

    return extensionApi.runtime.getURL(`region-failed.html?${params.toString()}`);
}

function isTargetRegionUrl(rawUrl) {
    const targetRegion = getTargetRegion(currentSettings);
    return Boolean(targetRegion) && appStoreRegion(rawUrl) === targetRegion;
}

function getManualJumpRegion() {
    const settings = normalizeSettings(currentSettings);

    if (!settings.manualJumpRegion || settings.manualJumpExpiresAt < Date.now())
        return "";

    return settings.manualJumpRegion;
}

function getNavigationSettings(url) {
    const manualJumpRegion = getManualJumpRegion();

    if (!manualJumpRegion || !parseAppStoreNavigationUrl(url))
        return currentSettings;

    return {
        ...currentSettings,
        mode: "preset",
        region: manualJumpRegion,
        customRegion: ""
    };
}

function getRedirectAttemptTabKey(tabId) {
    return `tab:${tabId}`;
}

function getRedirectAttemptGlobalKey(targetRegion) {
    return `global:${targetRegion}`;
}

async function getRedirectAttempts() {
    const stored = await extensionApi.storage.local.get({ [REDIRECT_LOOP_STORAGE_KEY]: {} });
    const attempts = stored[REDIRECT_LOOP_STORAGE_KEY];

    return attempts && typeof attempts === "object" && !Array.isArray(attempts)
        ? attempts
        : {};
}

async function setRedirectAttempts(attempts) {
    await extensionApi.storage.local.set({ [REDIRECT_LOOP_STORAGE_KEY]: attempts });
}

async function clearRedirectAttempt(tabId) {
    const attempts = await getRedirectAttempts();
    const tabKey = getRedirectAttemptTabKey(tabId);

    if (!(tabKey in attempts))
        return;

    delete attempts[tabKey];
    await setRedirectAttempts(attempts);
}

function getRememberedRedirectIntent(attempt, targetRegion, now) {
    if (attempt?.key !== targetRegion)
        return "";

    if (typeof attempt.intendedUrl !== "string" || !attempt.intendedUrl)
        return "";

    if (now - (attempt.intendedUpdatedAt ?? 0) > REDIRECT_INTENT_WINDOW_MS)
        return "";

    return appStoreRegion(attempt.intendedUrl) === targetRegion
        ? attempt.intendedUrl
        : "";
}

function getAttemptWithIntent(previousAttempt, targetRegion, intendedUrl, now) {
    const isSameTarget = previousAttempt?.key === targetRegion;

    return {
        count: isSameTarget ? (previousAttempt.count ?? 0) : 0,
        intendedUpdatedAt: now,
        intendedUrl,
        key: targetRegion,
        updatedAt: isSameTarget ? (previousAttempt.updatedAt ?? now) : now
    };
}

async function rememberRedirectIntent(tabId, targetUrl) {
    const targetRegion = appStoreRegion(targetUrl) || getTargetRegion(currentSettings);

    if (!targetRegion)
        return;

    const attempts = await getRedirectAttempts();
    const now = Date.now();
    const globalKey = getRedirectAttemptGlobalKey(targetRegion);

    attempts[globalKey] = getAttemptWithIntent(attempts[globalKey], targetRegion, targetUrl, now);

    if (typeof tabId === "number" && tabId >= 0) {
        const tabKey = getRedirectAttemptTabKey(tabId);
        attempts[tabKey] = getAttemptWithIntent(attempts[tabKey], targetRegion, targetUrl, now);
    }

    await setRedirectAttempts(attempts);
}

async function getRememberedRedirectTarget(tabId, candidateTargetUrl) {
    const targetRegion = appStoreRegion(candidateTargetUrl) || getTargetRegion(currentSettings);

    if (!targetRegion)
        return candidateTargetUrl;

    const attempts = await getRedirectAttempts();
    const now = Date.now();
    const tabKey = getRedirectAttemptTabKey(tabId);
    const globalKey = getRedirectAttemptGlobalKey(targetRegion);

    return getRememberedRedirectIntent(attempts[tabKey], targetRegion, now)
        || getRememberedRedirectIntent(attempts[globalKey], targetRegion, now)
        || candidateTargetUrl;
}

function getValidRememberedIntent(attempt, now) {
    if (typeof attempt?.intendedUrl !== "string" || !attempt.intendedUrl)
        return "";

    if (now - (attempt.intendedUpdatedAt ?? 0) > REDIRECT_INTENT_WINDOW_MS)
        return "";

    return parseAppStoreNavigationUrl(attempt.intendedUrl)?.toString() ?? "";
}

async function getRememberedQuickJumpSource(tabId, activeTabUrl) {
    const activeUrl = parseAppStoreNavigationUrl(activeTabUrl);
    const attempts = await getRedirectAttempts();
    const now = Date.now();
    const rememberedUrl = getValidRememberedIntent(attempts[getRedirectAttemptTabKey(tabId)], now);

    if (!rememberedUrl)
        return "";

    if (!activeUrl)
        return rememberedUrl;

    return appStoreRegion(activeUrl.toString()) !== appStoreRegion(rememberedUrl)
        ? rememberedUrl
        : "";
}

function getRegionFailedTargetUrl(rawUrl) {
    let url;
    let failedPageUrl;

    try {
        url = new URL(rawUrl);
        failedPageUrl = new URL(extensionApi.runtime.getURL("region-failed.html"));
    } catch {
        return "";
    }

    if (url.origin !== failedPageUrl.origin || url.pathname !== failedPageUrl.pathname)
        return "";

    return parseAppStoreNavigationUrl(url.searchParams.get("targetUrl") ?? "")?.toString() ?? "";
}

async function getQuickJumpSourceUrl(tabId, activeTabUrl) {
    const failedTargetUrl = getRegionFailedTargetUrl(activeTabUrl);

    if (failedTargetUrl)
        return failedTargetUrl;

    const rememberedUrl = await getRememberedQuickJumpSource(tabId, activeTabUrl);

    if (rememberedUrl)
        return rememberedUrl;

    return parseAppStoreNavigationUrl(activeTabUrl)?.toString() ?? "";
}

function scheduleRedirectAttemptClear(tabId, targetRegion) {
    if (typeof tabId !== "number" || !targetRegion)
        return;

    const pendingKey = `${tabId}:${targetRegion}`;
    clearTimeout(pendingRedirectClears.get(pendingKey));

    pendingRedirectClears.set(pendingKey, setTimeout(() => {
        pendingRedirectClears.delete(pendingKey);

        getRedirectAttempts().then(async (attempts) => {
            const tabKey = getRedirectAttemptTabKey(tabId);
            const globalKey = getRedirectAttemptGlobalKey(targetRegion);
            const now = Date.now();
            let changed = false;

            if (attempts[tabKey]?.key === targetRegion && now - attempts[tabKey].updatedAt >= REDIRECT_SUCCESS_CLEAR_DELAY_MS) {
                delete attempts[tabKey];
                changed = true;
            }

            if (attempts[globalKey]?.key === targetRegion && now - attempts[globalKey].updatedAt >= REDIRECT_SUCCESS_CLEAR_DELAY_MS) {
                delete attempts[globalKey];
                changed = true;
            }

            if (changed)
                await setRedirectAttempts(attempts);
        }).catch((error) => {
            console.error("Store Fix could not clear successful redirect attempts:", error);
        });
    }, REDIRECT_SUCCESS_CLEAR_DELAY_MS));
}

function getNextRedirectAttempt(previousAttempt, key, now) {
    const count = previousAttempt?.key === key && now - previousAttempt.updatedAt <= REDIRECT_LOOP_WINDOW_MS
        ? previousAttempt.count + 1
        : 1;
    const attempt = {
        count,
        key,
        updatedAt: now
    };

    if (previousAttempt?.key === key && previousAttempt.intendedUrl) {
        attempt.intendedUpdatedAt = previousAttempt.intendedUpdatedAt;
        attempt.intendedUrl = previousAttempt.intendedUrl;
    }

    return attempt;
}

async function getLoopFailureUrl(tabId, sourceUrl, targetUrl) {
    const targetRegion = appStoreRegion(targetUrl) || getTargetRegion(currentSettings);
    const sourceRegion = appStoreRegion(sourceUrl);

    if (!targetRegion) {
        await clearRedirectAttempt(tabId);
        return null;
    }

    if (sourceRegion === targetRegion)
        return null;

    const now = Date.now();
    const key = targetRegion;
    const attempts = await getRedirectAttempts();
    const tabKey = getRedirectAttemptTabKey(tabId);
    const globalKey = getRedirectAttemptGlobalKey(targetRegion);
    const tabAttempt = getNextRedirectAttempt(attempts[tabKey], key, now);
    const globalAttempt = getNextRedirectAttempt(attempts[globalKey], key, now);

    attempts[tabKey] = tabAttempt;
    attempts[globalKey] = globalAttempt;

    if (tabAttempt.count < REDIRECT_LOOP_LIMIT && globalAttempt.count < REDIRECT_LOOP_LIMIT) {
        await setRedirectAttempts(attempts);
        return null;
    }

    delete attempts[tabKey];
    delete attempts[globalKey];
    await setRedirectAttempts(attempts);
    return getRegionFailedUrl(sourceUrl, targetUrl);
}

async function getNavigationRedirect(tabId, url) {
    await settingsReady;

    if (!currentSettings.enabled)
        return null;

    if (shouldBypassAutoRedirect(url, currentSettings))
        return null;

    const navigationSettings = getNavigationSettings(url);

    if (currentSettings.forceOpenMode !== "off") {
        const candidateTargetUrl = getForcedAppStoreUrl(url, navigationSettings);

        if (!candidateTargetUrl)
            return null;

        const targetUrl = await getRememberedRedirectTarget(tabId, candidateTargetUrl);
        await rememberRedirectIntent(tabId, targetUrl);
        await setManualJumpBypass(targetUrl, getTargetRegion(navigationSettings));
        return {
            targetUrl,
            url: getForceOpenUrl(targetUrl)
        };
    }

    const candidateTargetUrl = rewriteAppStoreUrl(url, navigationSettings);

    if (!candidateTargetUrl)
        return null;

    const targetUrl = await getRememberedRedirectTarget(tabId, candidateTargetUrl);
    await rememberRedirectIntent(tabId, targetUrl);

    return { targetUrl, url: targetUrl };
}

async function redirectTab(tabId, url) {
    if (typeof tabId !== "number" || tabId < 0)
        return { changed: false };

    const redirect = await getNavigationRedirect(tabId, url);

    if (!redirect || redirect.url === url) {
        if (isTargetRegionUrl(url)) {
            await rememberRedirectIntent(tabId, url);
            scheduleRedirectAttemptClear(tabId, appStoreRegion(url));
        } else if (!shouldBypassAutoRedirect(url, currentSettings)) {
            await clearRedirectAttempt(tabId);
        }

        return { changed: false };
    }

    const failureUrl = await getLoopFailureUrl(tabId, url, redirect.targetUrl);
    const nextUrl = failureUrl ?? redirect.url;

    await extensionApi.tabs.update(tabId, { url: nextUrl });
    return { changed: true, failed: Boolean(failureUrl), url: nextUrl };
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

    const sourceUrl = await getQuickJumpSourceUrl(activeTab.id, activeTab.url);

    if (!sourceUrl)
        return { changed: false };

    const targetUrl = rewriteAppStoreUrl(sourceUrl, {
        ...currentSettings,
        enabled: true,
        mode: "preset",
        region: targetRegion,
        customRegion: ""
    });

    if (!targetUrl)
        return { changed: false };

    await rememberRedirectIntent(activeTab.id, targetUrl);
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

        await rememberRedirectIntent(newTab.id, targetUrl);
        return { changed: true, tabId: newTab.id, url: targetUrl };
    }

    await extensionApi.tabs.update(activeTab.id, { url: openUrl });
    return { changed: true, tabId: activeTab.id, url: targetUrl };
}

async function getQuickJumpContext() {
    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (typeof activeTab?.id !== "number" || !activeTab.url)
        return { canJump: false, url: "" };

    const sourceUrl = await getQuickJumpSourceUrl(activeTab.id, activeTab.url);
    return {
        canJump: Boolean(sourceUrl),
        url: sourceUrl
    };
}

async function openForcedAppStoreLink(url) {
    await settingsReady;

    if (!currentSettings.enabled || currentSettings.forceOpenMode === "off")
        return { changed: false };

    const targetUrl = getForcedAppStoreUrl(url, currentSettings);

    if (!targetUrl)
        return { changed: false };

    await rememberRedirectIntent(null, targetUrl);
    await setManualJumpBypass(targetUrl, getTargetRegion(currentSettings));

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

    await rememberRedirectIntent(createdTab.id, targetUrl);
    return { changed: true, tabId: createdTab.id, url: targetUrl };
}

async function redirectSenderTab(sender, url) {
    if (typeof sender?.tab?.id !== "number")
        return { changed: false };

    return redirectTab(sender.tab.id, url);
}

async function registerSenderIntent(sender, url) {
    await settingsReady;

    const targetUrl = getForcedAppStoreUrl(url, currentSettings);

    if (!targetUrl)
        return { changed: false };

    await rememberRedirectIntent(sender?.tab?.id, targetUrl);
    return { changed: true, url: targetUrl };
}

async function continueWithSourceRegion(sender, targetUrl, sourceRegion) {
    await settingsReady;

    const region = sanitizeRegion(sourceRegion);

    if (!region)
        return { changed: false };

    const continueUrl = rewriteAppStoreUrl(targetUrl, {
        ...currentSettings,
        enabled: true,
        mode: "preset",
        region,
        customRegion: ""
    });

    if (!continueUrl)
        return { changed: false };

    const tabId = sender?.tab?.id;

    if (typeof tabId === "number" && tabId >= 0)
        await clearRedirectAttempt(tabId);

    await setManualJumpBypass(continueUrl, region);

    const openUrl = currentSettings.forceOpenMode === "off"
        ? continueUrl
        : getForceOpenUrl(continueUrl, false);

    if (typeof tabId === "number" && tabId >= 0) {
        await extensionApi.tabs.update(tabId, { url: openUrl });
        return { changed: true, tabId, url: continueUrl };
    }

    return { changed: false, url: openUrl };
}

extensionApi.runtime.onInstalled.addListener(() => {
    settingsReady = refreshSettings();
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.keys(changes).some((key) => key in DEFAULT_SETTINGS))
        settingsReady = refreshSettings();
});

extensionApi.tabs?.onRemoved?.addListener((tabId) => {
    clearRedirectAttempt(tabId).catch((error) => {
        console.error("Store Fix could not clear redirect attempts:", error);
    });
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

extensionApi.runtime.onMessage.addListener((request, sender) => {
    if (request?.type === "store-fix-normalize-url")
        return getRedirectUrl(request.url).then((url) => ({ url }));

    if (request?.type === "store-fix-redirect-current-page")
        return redirectSenderTab(sender, request.url);

    if (request?.type === "store-fix-register-intended-url")
        return registerSenderIntent(sender, request.url);

    if (request?.type === "store-fix-continue-source-region")
        return continueWithSourceRegion(sender, request.targetUrl, request.sourceRegion);

    if (request?.type === "store-fix-get-quick-jump-context")
        return getQuickJumpContext();

    if (request?.type === "store-fix-fix-current-tab")
        return fixCurrentTab();

    if (request?.type === "store-fix-open-quick-jump")
        return openQuickJump(request.region, request.openMode);

    if (request?.type === "store-fix-open-forced-window")
        return openForcedAppStoreLink(request.url);

    return undefined;
});
