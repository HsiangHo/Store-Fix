(() => {
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        mode: "preset",
        region: "cn",
        customRegion: "",
        quickOpenMode: "current-tab",
        forceOpenMode: "off",
        forceNewWindow: false,
        manualJumpUrl: "",
        manualJumpRegion: "",
        manualJumpExpiresAt: 0,
        regionUsageCounts: {}
    });

    const PRESET_REGIONS = Object.freeze(globalThis.StoreFixRegions?.REGION_CODES ?? ["cn", "hk", "jp", "us", "ca"]);
    const REGION_PATTERN = /^[a-z]{2}$/;
    const APP_STORE_HOST = "apps.apple.com";
    const APP_STORE_WEB_PROTOCOLS = new Set(["http:", "https:"]);
    const APP_STORE_DEEP_LINK_PROTOCOLS = new Set(["itms-apps:", "itms-appss:"]);
    const APP_STORE_PROTOCOLS = new Set([
        ...APP_STORE_WEB_PROTOCOLS,
        ...APP_STORE_DEEP_LINK_PROTOCOLS
    ]);
    const FORCE_OPEN_MODES = new Set(["off", "new-window", "new-tab"]);

    function sanitizeRegion(value) {
        if (typeof value !== "string")
            return "";

        const region = value.trim().toLowerCase();
        return REGION_PATTERN.test(region) ? region : "";
    }

    function normalizeSettings(settings = {}) {
        const presetRegion = sanitizeRegion(settings.region);
        const customRegion = sanitizeRegion(settings.customRegion);
        const region = PRESET_REGIONS.includes(presetRegion) ? presetRegion : DEFAULT_SETTINGS.region;
        const manualJumpExpiresAt = Number.isFinite(settings.manualJumpExpiresAt)
            ? settings.manualJumpExpiresAt
            : DEFAULT_SETTINGS.manualJumpExpiresAt;
        const forceOpenMode = FORCE_OPEN_MODES.has(settings.forceOpenMode)
            ? settings.forceOpenMode
            : (settings.forceNewWindow === true ? "new-window" : DEFAULT_SETTINGS.forceOpenMode);
        const regionUsageCounts = Object.entries(settings.regionUsageCounts ?? {}).reduce((counts, [code, count]) => {
            const region = sanitizeRegion(code);
            const normalizedCount = Number(count);

            if (PRESET_REGIONS.includes(region) && Number.isFinite(normalizedCount) && normalizedCount > 0)
                counts[region] = Math.min(Math.floor(normalizedCount), Number.MAX_SAFE_INTEGER);

            return counts;
        }, {});

        return {
            enabled: settings.enabled !== false,
            mode: settings.mode === "custom" ? "custom" : "preset",
            region,
            customRegion,
            quickOpenMode: settings.quickOpenMode === "new-tab" ? "new-tab" : "current-tab",
            forceOpenMode,
            forceNewWindow: forceOpenMode === "new-window",
            manualJumpUrl: typeof settings.manualJumpUrl === "string" ? settings.manualJumpUrl : "",
            manualJumpRegion: sanitizeRegion(settings.manualJumpRegion),
            manualJumpExpiresAt,
            regionUsageCounts
        };
    }

    function getTargetRegion(settings = {}) {
        const normalizedSettings = normalizeSettings(settings);

        if (normalizedSettings.mode === "custom" && normalizedSettings.customRegion)
            return normalizedSettings.customRegion;

        return normalizedSettings.region;
    }

    function getRegionalPathSegments(pathname, targetRegion) {
        const segments = pathname.split("/").filter(Boolean);
        const pathSegments = REGION_PATTERN.test((segments[0] ?? "").toLowerCase())
            ? segments.slice(1)
            : segments;

        return [targetRegion, ...pathSegments];
    }

    function getUrlRegion(url) {
        const segments = url.pathname.split("/").filter(Boolean);
        return sanitizeRegion(segments[0]);
    }

    function parseAppStoreUrl(rawUrl, baseUrl) {
        let url;

        try {
            url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
        } catch {
            return null;
        }

        if (url.hostname.toLowerCase() !== APP_STORE_HOST)
            return null;

        if (!APP_STORE_PROTOCOLS.has(url.protocol))
            return null;

        return url;
    }

    function normalizeAppStorePageUrl(rawUrl, baseUrl) {
        const url = parseAppStoreUrl(rawUrl, baseUrl);

        if (!url)
            return null;

        if (APP_STORE_DEEP_LINK_PROTOCOLS.has(url.protocol))
            return `https://${url.host}${url.pathname}${url.search}${url.hash}`;

        url.protocol = "https:";
        return url.toString();
    }

    function isAppStoreDeepLinkUrl(rawUrl, baseUrl) {
        const url = parseAppStoreUrl(rawUrl, baseUrl);
        return Boolean(url && APP_STORE_DEEP_LINK_PROTOCOLS.has(url.protocol));
    }

    function getNativeAppStoreUrl(rawUrl, platform) {
        const url = parseAppStoreUrl(rawUrl);
        const protocol = platform === "mac" ? "macappstore:" : platform === "ios" ? "itms-apps:" : null;

        if (!url || !protocol || url.username || url.password || url.port)
            return null;

        // URL.protocol cannot switch between web and custom schemes.
        return `${protocol}//${APP_STORE_HOST}${url.pathname}${url.search}${url.hash}`;
    }

    function rewriteAppStoreUrl(rawUrl, settings = DEFAULT_SETTINGS, baseUrl) {
        const url = parseAppStoreUrl(rawUrl, baseUrl);

        if (!url)
            return null;

        const targetRegion = getTargetRegion(settings);

        if (!targetRegion)
            return null;

        if (url.protocol === "http:")
            url.protocol = "https:";

        url.pathname = `/${getRegionalPathSegments(url.pathname, targetRegion).join("/")}`;

        return url.toString();
    }

    function getForcedAppStoreUrl(rawUrl, settings = DEFAULT_SETTINGS, baseUrl) {
        const normalizedUrl = normalizeAppStorePageUrl(rawUrl, baseUrl);

        if (!normalizedUrl)
            return null;

        return rewriteAppStoreUrl(normalizedUrl, settings) ?? normalizedUrl;
    }

    function shouldBypassAutoRedirect(rawUrl, settings = DEFAULT_SETTINGS) {
        const normalizedSettings = normalizeSettings(settings);

        if (!normalizedSettings.manualJumpUrl || normalizedSettings.manualJumpExpiresAt < Date.now())
            return false;

        let currentUrl;

        try {
            currentUrl = new URL(rawUrl).toString();
        } catch {
            return false;
        }

        if (currentUrl === normalizedSettings.manualJumpUrl)
            return true;

        if (!normalizedSettings.manualJumpRegion)
            return false;

        const appStoreUrl = parseAppStoreUrl(currentUrl);

        if (!appStoreUrl)
            return false;

        return getUrlRegion(appStoreUrl) === normalizedSettings.manualJumpRegion;
    }

    globalThis.StoreFixUrl = Object.freeze({
        DEFAULT_SETTINGS,
        PRESET_REGIONS,
        getForcedAppStoreUrl,
        getNativeAppStoreUrl,
        getTargetRegion,
        isAppStoreDeepLinkUrl,
        normalizeAppStorePageUrl,
        normalizeSettings,
        rewriteAppStoreUrl,
        sanitizeRegion,
        shouldBypassAutoRedirect
    });
})();
