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

// History means the redirect replaced a page the user was on, rather than a
// link that already opened in a fresh tab. document.referrer is not reliable
// after Safari redirects to an extension page, so it is not used here.
function canReturnToSourcePage() {
    return window.history.length > 1;
}

async function prepareRedirectedNavigation() {
    try {
        const response = await extensionApi.runtime.sendMessage({
            type: "store-fix-prepare-redirected-navigation",
            url: targetUrl,
            openSeparately: canReturnToSourcePage()
        });

        return {
            openedSeparately: response?.openedSeparately === true,
            url: normalizeAppStorePageUrl(response?.url ?? "") ?? targetUrl
        };
    } catch (error) {
        console.error("Store Fix could not prepare the redirected App Store URL:", error);
        return { openedSeparately: false, url: targetUrl };
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
                const { openedSeparately, url } = await prepareRedirectedNavigation();
                fallbackLink.href = url;

                if (openedSeparately)
                    window.history.back();
                else
                    window.location.replace(url);

                return;
            }

            if (shouldRegisterIntent)
                await registerIntent();

            window.location.replace(targetUrl);
        }, 100);
    }
}
