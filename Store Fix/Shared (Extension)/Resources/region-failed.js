const extensionApi = globalThis.browser ?? globalThis.chrome;
const params = new URLSearchParams(window.location.search);
const targetRegion = params.get("targetRegion") || "";
const sourceRegion = params.get("sourceRegion") || "";
const targetUrl = params.get("targetUrl") || "";

const FALLBACK_MESSAGES = Object.freeze({
    redirectFailedTitle: "Cannot open $1 App Store",
    redirectFailedDescription: "Apple keeps redirecting this page back to $2 based on your network location. To open $1, change your IP/VPN or choose another App Store region.",
    redirectFailedTargetUrl: "Target URL: $1",
    redirectFailedContinueButton: "Continue with $1 region"
});

function getMessage(messageName, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    const localizedMessage = extensionApi.i18n?.getMessage?.(messageName, values);

    if (localizedMessage)
        return localizedMessage;

    return values.reduce((message, value, index) => {
        return message.replaceAll(`$${index + 1}`, String(value));
    }, FALLBACK_MESSAGES[messageName] ?? messageName);
}

const targetLabel = targetRegion || "the selected region";
const sourceLabel = sourceRegion || "your current region";
const heading = document.querySelector("#heading");
const description = document.querySelector("#description");
const targetUrlOutput = document.querySelector("#target-url");
const continueButton = document.querySelector("#continue-button");

document.title = getMessage("redirectFailedTitle", targetLabel);
heading.textContent = getMessage("redirectFailedTitle", targetLabel);
description.textContent = getMessage("redirectFailedDescription", [targetLabel, sourceLabel]);
targetUrlOutput.textContent = getMessage("redirectFailedTargetUrl", targetUrl || "Unavailable");

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
