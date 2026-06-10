const { normalizeAppStorePageUrl } = globalThis.StoreFixUrl;
const extensionApi = globalThis.browser ?? globalThis.chrome;

const fallbackLink = document.querySelector("#fallback");
const params = new URLSearchParams(window.location.search);
const targetUrl = normalizeAppStorePageUrl(params.get("url") ?? "");
const shouldRegisterIntent = params.get("registerIntent") !== "0";

if (targetUrl) {
    fallbackLink.href = targetUrl;

    window.setTimeout(async () => {
        if (shouldRegisterIntent) {
            try {
                await extensionApi.runtime.sendMessage({
                    type: "store-fix-register-intended-url",
                    url: targetUrl
                });
            } catch (error) {
                console.error("Store Fix could not register the intended App Store URL:", error);
            }
        }

        window.location.replace(targetUrl);
    }, 100);
}
