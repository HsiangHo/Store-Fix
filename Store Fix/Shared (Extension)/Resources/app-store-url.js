(() => {
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        mode: "preset",
        region: "cn",
        customRegion: "",
        quickOpenMode: "current-tab",
        manualJumpUrl: "",
        manualJumpExpiresAt: 0,
        regionUsageCounts: {}
    });

    const PRESET_REGIONS = Object.freeze(globalThis.StoreFixRegions?.REGION_CODES ?? ["cn", "hk", "jp", "us", "ca"]);
    const REGION_PATTERN = /^[a-z]{2}$/;
    const APP_STORE_HOST = "apps.apple.com";

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
            manualJumpUrl: typeof settings.manualJumpUrl === "string" ? settings.manualJumpUrl : "",
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

    function getAppPathSegments(pathname) {
        const segments = pathname.split("/").filter(Boolean);

        if (segments[0]?.toLowerCase() === "app")
            return segments;

        if (REGION_PATTERN.test((segments[0] ?? "").toLowerCase()) && segments[1]?.toLowerCase() === "app")
            return segments.slice(1);

        return null;
    }

    function rewriteAppStoreUrl(rawUrl, settings = DEFAULT_SETTINGS, baseUrl) {
        let url;

        try {
            url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
        } catch {
            return null;
        }

        if (url.hostname.toLowerCase() !== APP_STORE_HOST)
            return null;

        if (url.protocol !== "https:" && url.protocol !== "http:")
            return null;

        const targetRegion = getTargetRegion(settings);
        const appPathSegments = getAppPathSegments(url.pathname);

        if (!targetRegion || !appPathSegments)
            return null;

        url.protocol = "https:";
        url.pathname = `/${[targetRegion, ...appPathSegments].join("/")}`;

        return url.toString();
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

        return currentUrl === normalizedSettings.manualJumpUrl;
    }

    globalThis.StoreFixUrl = Object.freeze({
        DEFAULT_SETTINGS,
        PRESET_REGIONS,
        getTargetRegion,
        normalizeSettings,
        rewriteAppStoreUrl,
        sanitizeRegion,
        shouldBypassAutoRedirect
    });
})();
