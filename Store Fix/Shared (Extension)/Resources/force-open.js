const { normalizeAppStorePageUrl } = globalThis.StoreFixUrl;
const extensionApi = globalThis.browser ?? globalThis.chrome;

const fallbackLink = document.querySelector("#fallback");
const params = new URLSearchParams(window.location.search);
// The force-open redirect rule appends the original URL as the fragment, unencoded.
const isRedirectedNavigation = params.get("source") === "redirect";
const targetUrl = normalizeAppStorePageUrl(
    isRedirectedNavigation ? window.location.hash.slice(1) : (params.get("url") ?? "")
);
const shouldRegisterIntent = params.get("registerIntent") !== "0";
const REDIRECT_LOOP_STORAGE_KEY = "storeFixForceOpenRedirects";
const REDIRECT_LOOP_LIMIT = 3;
const REDIRECT_LOOP_WINDOW_MS = 10000;

function isRedirectLoop(url) {
    try {
        const now = Date.now();
        const recent = JSON.parse(sessionStorage.getItem(REDIRECT_LOOP_STORAGE_KEY) ?? "[]")
            .filter((entry) => entry?.url === url && now - entry.at < REDIRECT_LOOP_WINDOW_MS);

        recent.push({ url, at: now });
        sessionStorage.setItem(REDIRECT_LOOP_STORAGE_KEY, JSON.stringify(recent));
        return recent.length >= REDIRECT_LOOP_LIMIT;
    } catch {
        return false;
    }
}

async function getRedirectedNavigationUrl() {
    try {
        const response = await extensionApi.runtime.sendMessage({
            type: "store-fix-prepare-redirected-navigation",
            url: targetUrl
        });

        return normalizeAppStorePageUrl(response?.url ?? "") ?? targetUrl;
    } catch (error) {
        console.error("Store Fix could not prepare the redirected App Store URL:", error);
        return targetUrl;
    }
}

async function registerIntent() {
    try {
        await extensionApi.runtime.sendMessage({
            type: "store-fix-register-intended-url",
            url: targetUrl
        });
    } catch (error) {
        console.error("Store Fix could not register the intended App Store URL:", error);
    }
}

if (targetUrl) {
    fallbackLink.href = targetUrl;

    if (!isRedirectedNavigation || !isRedirectLoop(targetUrl)) {
        window.setTimeout(async () => {
            if (isRedirectedNavigation) {
                const nextUrl = await getRedirectedNavigationUrl();
                fallbackLink.href = nextUrl;
                window.location.replace(nextUrl);
                return;
            }

            if (shouldRegisterIntent)
                await registerIntent();

            window.location.replace(targetUrl);
        }, 100);
    }
}
