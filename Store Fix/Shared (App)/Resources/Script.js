function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    const settingsName = useSettingsInsteadOfPreferences
        ? "Safari Settings"
        : "Safari Extensions Preferences";
    const settingsLocation = useSettingsInsteadOfPreferences
        ? "the Extensions section of Safari Settings"
        : "Safari Extensions preferences";

    if (useSettingsInsteadOfPreferences) {
        document.querySelector(".status-panel.state-unknown p").innerText = "You can enable Store Fix from the Extensions section of Safari Settings.";
        document.querySelector(".status-panel.state-off p").innerText = "Turn on Store Fix in the Extensions section of Safari Settings to start fixing App Store links.";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
        document.querySelector("button.open-preferences").innerText = enabled
            ? `Manage in ${settingsName}`
            : `Open ${settingsName}`;
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
        document.querySelector("button.open-preferences").innerText = `Open ${settingsName}`;
    }

    document.querySelector(".status-panel.state-on p").innerText = `Use the Safari toolbar popup to choose your fixed region, or manage Store Fix from ${settingsLocation}.`;
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
