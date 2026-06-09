const { normalizeAppStorePageUrl } = globalThis.StoreFixUrl;

const fallbackLink = document.querySelector("#fallback");
const params = new URLSearchParams(window.location.search);
const targetUrl = normalizeAppStorePageUrl(params.get("url") ?? "");

if (targetUrl) {
    fallbackLink.href = targetUrl;

    window.setTimeout(() => {
        window.location.replace(targetUrl);
    }, 100);
}
