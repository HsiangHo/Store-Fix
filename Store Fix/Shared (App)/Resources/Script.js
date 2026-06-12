function setExtensionState(enabled) {
    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function show(platform, enabled, platformOption) {
    document.body.classList.add(`platform-${platform}`);

    if (platform === "ios") {
        const canOpenExtensionSettings = platformOption === true;
        document.body.classList.toggle("settings-supported", canOpenExtensionSettings);
        setExtensionState(enabled);

        const button = document.querySelector("button.open-extension-settings");
        button.innerText = enabled
            ? "Manage Safari Extension"
            : "Open Safari Extension Settings";

        return;
    }

    const useSettingsInsteadOfPreferences = platformOption === true;
    const settingsName = useSettingsInsteadOfPreferences
        ? "Safari Settings"
        : "Safari Extensions Preferences";
    const settingsLocation = useSettingsInsteadOfPreferences
        ? "the Extensions section of Safari Settings"
        : "Safari Extensions preferences";

    if (useSettingsInsteadOfPreferences) {
        document.querySelector(".status-panel.platform-mac.state-unknown p").innerText = "You can enable Store Fix from the Extensions section of Safari Settings.";
        document.querySelector(".status-panel.platform-mac.state-off p").innerText = "Turn on Store Fix in the Extensions section of Safari Settings to start fixing App Store links.";
    }

    setExtensionState(enabled);

    document.querySelector("button.open-preferences").innerText = enabled
        ? `Manage in ${settingsName}`
        : `Open ${settingsName}`;

    document.querySelector(".status-panel.platform-mac.state-on p").innerText = `Use the Safari toolbar popup to choose your fixed region, or manage Store Fix from ${settingsLocation}.`;
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

function openExtensionSettings() {
    webkit.messageHandlers.controller.postMessage("open-extension-settings");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
document.querySelector("button.open-extension-settings").addEventListener("click", openExtensionSettings);
