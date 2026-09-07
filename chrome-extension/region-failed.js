const extensionApi = globalThis.browser ?? globalThis.chrome;
const params = new URLSearchParams(window.location.search);
const targetRegion = params.get("targetRegion") || "";
const sourceRegion = params.get("sourceRegion") || "";
const targetUrl = params.get("targetUrl") || "";

const FALLBACK_MESSAGES = Object.freeze({
    redirectFailedTitle: "Cannot open $1 App Store",
    redirectFailedDescription: "Apple keeps redirecting this page back to $2 based on your network location. To open $1, change your IP/VPN or choose another App Store region.",
    redirectFailedTargetUrl: "Target URL: $1",
    redirectFailedContinueButton: "Continue with $1 region",
    redirectFailedOpenAppStoreButton: "Open in App Store",
    redirectFailedCopyButton: "Copy URL",
    redirectFailedCopied: "Copied",
    redirectFailedCopyError: "Copy failed. Try again."
});

function getMessage(messageName, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    const localizedMessage = extensionApi?.i18n?.getMessage?.(messageName, values);

    if (localizedMessage)
        return localizedMessage;

    return values.reduce((message, value, index) => {
        return message.replaceAll(`$${index + 1}`, String(value));
    }, FALLBACK_MESSAGES[messageName] ?? messageName);
}

function getNativePlatform() {
    if (/\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
        return "ios";

    if (/mac/i.test(navigator.userAgentData?.platform ?? navigator.platform)
        || /\bMacintosh\b/.test(navigator.userAgent))
        return "mac";

    return "";
}

const targetLabel = targetRegion || "the selected region";
const sourceLabel = sourceRegion || "your current region";
const heading = document.querySelector("#heading");
const description = document.querySelector("#description");
const targetUrlOutput = document.querySelector("#target-url");
const copyButton = document.querySelector("#copy-url-button");
const copyTooltip = document.querySelector("#copy-tooltip");
const copyStatus = document.querySelector("#copy-status");
const continueButton = document.querySelector("#continue-button");
const openAppStoreButton = document.querySelector("#open-app-store-button");
const nativeAppStoreUrl = globalThis.StoreFixUrl.getNativeAppStoreUrl(targetUrl, getNativePlatform());

document.title = getMessage("redirectFailedTitle", targetLabel);
heading.textContent = getMessage("redirectFailedTitle", targetLabel);
description.textContent = getMessage("redirectFailedDescription", [targetLabel, sourceLabel]);
targetUrlOutput.textContent = getMessage("redirectFailedTargetUrl", targetUrl || "Unavailable");

function setCopyState(state) {
    const messageName = state === "copied" ? "redirectFailedCopied"
        : state === "error" ? "redirectFailedCopyError" : "redirectFailedCopyButton";
    const message = getMessage(messageName);
    copyButton.dataset.state = state;
    copyButton.setAttribute("aria-label", message);
    copyTooltip.textContent = message;
    copyStatus.textContent = state === "copied" || state === "error" ? message : "";
}

let copyResetTimer;
setCopyState("idle");
copyButton.disabled = !targetUrl;

copyButton.addEventListener("click", async () => {
    if (!targetUrl || copyButton.disabled)
        return;

    window.clearTimeout(copyResetTimer);
    copyButton.disabled = true;
    copyButton.setAttribute("aria-busy", "true");
    setCopyState("copying");

    try {
        await navigator.clipboard.writeText(targetUrl);
        setCopyState("copied");
    } catch (error) {
        console.error("Store Fix could not copy the target App Store URL:", error);
        setCopyState("error");
    } finally {
        copyButton.disabled = false;
        copyButton.setAttribute("aria-busy", "false");
        copyResetTimer = window.setTimeout(() => setCopyState("idle"), 2000);
    }
});

if (nativeAppStoreUrl) {
    openAppStoreButton.href = nativeAppStoreUrl;
    openAppStoreButton.textContent = getMessage("redirectFailedOpenAppStoreButton");
    openAppStoreButton.hidden = false;
}

if (sourceRegion && targetUrl) {
    continueButton.hidden = false;
    continueButton.textContent = getMessage("redirectFailedContinueButton", sourceLabel);

    continueButton.addEventListener("click", async () => {
        continueButton.disabled = true;

        try {
            const response = await extensionApi.runtime.sendMessage({
                type: "store-fix-continue-source-region",
                sourceRegion,
                targetUrl
            });

            if (response?.changed)
                return;

            if (response?.url) {
                window.location.assign(response.url);
                return;
            }
        } catch (error) {
            console.error("Store Fix could not continue with the redirected App Store region:", error);
        }

        continueButton.disabled = false;
    });
}
