const extensionApi = globalThis.browser ?? globalThis.chrome;
const {
    DEFAULT_SETTINGS,
    getTargetRegion,
    normalizeSettings
} = globalThis.StoreFixUrl;

const {
    ALL_REGIONS,
    COMMON_REGION_CODES,
    REGION_BY_CODE,
    REGION_FILTERS
} = globalThis.StoreFixRegions;

const REGION_PREVIEW_LIMIT = 6;
const QUICK_PREVIEW_LIMIT = 4;
const COMMON_REGION_ORDER = new Map(COMMON_REGION_CODES.map((code, index) => [code, index]));
const UI_LOCALE = extensionApi.i18n?.getUILanguage?.() ?? document.documentElement.lang ?? "en";
const NORMALIZED_UI_LOCALE = UI_LOCALE.replace("_", "-");
const FALLBACK_MESSAGES = Object.freeze({
    fixedRegionLabel: "Fix country or region",
    editRegion: "Edit",
    doneEditing: "Done",
    searchRegionPlaceholder: "Search country, region, or code",
    regionFilterAria: "Filter fixed region by location",
    fixedRegionGridAria: "Fixed region",
    showAllRegions: "Show all $1 regions",
    collapseRegions: "Collapse regions",
    quickJumpTitle: "Quick Jump",
    quickSettingsTitle: "Jump settings",
    openCurrentTab: "Open in current tab",
    openNewTab: "Open in new tab",
    forceOpenModeLabel: "Force App Store links to open in Chrome",
    forceOpenModeDescription: "Keep apps.apple.com links in Chrome instead of handing them to App Store.",
    forceOpenOff: "Off",
    forceOpenNewWindow: "Window",
    forceOpenNewTab: "Tab",
    quickFilterAria: "Filter quick jump regions by location",
    quickGridAria: "Quick jump regions",
    noMatchingRegion: "No matching regions",
    currentFixedRegionAria: "Current fixed region: $1",
    invalidRegionCode: "Enter a two-letter region code, for example tw",
    notAppStoreAppLink: "The current tab is not an App Store link",
    regionFilterAll: "All",
    regionFilterAsiaPacific: "Asia Pacific",
    regionFilterUsaCanada: "USA/Canada",
    regionFilterEurope: "Europe",
    regionFilterLatinAmericaCaribbean: "Latin America/Caribbean",
    regionFilterAfricaMiddleEastIndia: "Africa/Middle East/India"
});

const enabledInput = document.querySelector("#enabled");
const forceOpenMode = document.querySelector("#force-open-mode");
const forceOpenModeLabel = document.querySelector("#force-open-mode-label");
const forceOpenModeDescription = document.querySelector("#force-open-mode-description");
const fixedRegionLabel = document.querySelector("#fixed-region-label");
const currentRegionOutput = document.querySelector("#current-region");
const regionEditor = document.querySelector("#region-editor");
const regionEditToggle = document.querySelector("#region-edit-toggle");
const regionGrid = document.querySelector("#region-grid");
const regionSearchInput = document.querySelector("#region-search");
const regionFilter = document.querySelector("#region-filter");
const regionMoreButton = document.querySelector("#region-more");
const quickSection = document.querySelector(".quick-section");
const quickSearchInput = document.querySelector("#quick-search");
const quickFilter = document.querySelector("#quick-filter");
const quickGrid = document.querySelector("#quick-grid");
const quickMoreButton = document.querySelector("#quick-more");
const quickJumpTitle = document.querySelector("#quick-jump-title");
const quickSettingsButton = document.querySelector("#quick-settings");
const quickMenu = document.querySelector("#quick-menu");
const statusOutput = document.querySelector("#status");

let settings = normalizeSettings(DEFAULT_SETTINGS);
let saveTimer;
let canQuickJump = false;
let regionEditorOpen = false;
let regionExpanded = false;
let regionFilterKey = "all";
let quickExpanded = false;
let quickFilterKey = "all";
let regionNameFormatter;

try {
    regionNameFormatter = new Intl.DisplayNames([NORMALIZED_UI_LOCALE], { type: "region" });
} catch {
    regionNameFormatter = null;
}

function getMessage(messageName, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    const localizedMessage = extensionApi.i18n?.getMessage?.(messageName, values);

    if (localizedMessage)
        return localizedMessage;

    return values.reduce((message, value, index) => {
        return message.replaceAll(`$${index + 1}`, String(value));
    }, FALLBACK_MESSAGES[messageName] ?? messageName);
}

function localizedRegionName(region) {
    if (!/^zh([-_]|$)/i.test(UI_LOCALE))
        return region.name;

    try {
        return regionNameFormatter?.of(region.code.toUpperCase()) ?? region.name;
    } catch {
        return region.name;
    }
}

function applyLocalization() {
    const searchLabel = getMessage("searchRegionPlaceholder");
    const quickSettingsTitle = getMessage("quickSettingsTitle");

    document.documentElement.lang = NORMALIZED_UI_LOCALE;
    fixedRegionLabel.textContent = getMessage("fixedRegionLabel");
    forceOpenModeLabel.textContent = getMessage("forceOpenModeLabel");
    forceOpenModeDescription.textContent = getMessage("forceOpenModeDescription");
    forceOpenMode.setAttribute("aria-label", getMessage("forceOpenModeLabel"));
    forceOpenMode.querySelector("[data-force-open-mode='off']").textContent = getMessage("forceOpenOff");
    forceOpenMode.querySelector("[data-force-open-mode='new-window']").textContent = getMessage("forceOpenNewWindow");
    forceOpenMode.querySelector("[data-force-open-mode='new-tab']").textContent = getMessage("forceOpenNewTab");
    regionSearchInput.placeholder = searchLabel;
    regionSearchInput.setAttribute("aria-label", searchLabel);
    regionFilter.setAttribute("aria-label", getMessage("regionFilterAria"));
    regionGrid.setAttribute("aria-label", getMessage("fixedRegionGridAria"));
    quickJumpTitle.textContent = getMessage("quickJumpTitle");
    quickSearchInput.placeholder = searchLabel;
    quickSearchInput.setAttribute("aria-label", searchLabel);
    quickFilter.setAttribute("aria-label", getMessage("quickFilterAria"));
    quickGrid.setAttribute("aria-label", getMessage("quickGridAria"));
    quickSettingsButton.title = quickSettingsTitle;
    quickSettingsButton.setAttribute("aria-label", quickSettingsTitle);
    quickMenu.querySelector("[data-open-mode='current-tab']").textContent = getMessage("openCurrentTab");
    quickMenu.querySelector("[data-open-mode='new-tab']").textContent = getMessage("openNewTab");
}

function setStatus(message, isError = false) {
    statusOutput.textContent = message;
    statusOutput.classList.toggle("error", isError);
}

function clearStatus() {
    setStatus("");
}

function closePopup() {
    window.setTimeout(() => {
        window.close();
    }, 0);
}

function selectedRegionCode() {
    return getTargetRegion(settings);
}

function selectedRegion() {
    return REGION_BY_CODE[selectedRegionCode()];
}

function normalizeSearch(value) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function regionMatchesQuery(region, query) {
    if (!query)
        return true;

    const searchableText = normalizeSearch(`${region.code} ${region.name} ${localizedRegionName(region)}`);
    return searchableText.includes(query);
}

function regionMatchesFilter(region, filterKey) {
    return filterKey === "all" || region.group === filterKey;
}

function regionUsageCount(code) {
    return settings.regionUsageCounts?.[code] ?? 0;
}

function compareRegions(left, right) {
    const usageDifference = regionUsageCount(right.code) - regionUsageCount(left.code);

    if (usageDifference !== 0)
        return usageDifference;

    const leftCommonIndex = COMMON_REGION_ORDER.get(left.code) ?? Number.MAX_SAFE_INTEGER;
    const rightCommonIndex = COMMON_REGION_ORDER.get(right.code) ?? Number.MAX_SAFE_INTEGER;

    if (leftCommonIndex !== rightCommonIndex)
        return leftCommonIndex - rightCommonIndex;

    return localizedRegionName(left).localeCompare(localizedRegionName(right), NORMALIZED_UI_LOCALE)
        || left.code.localeCompare(right.code);
}

function sortedRegions(regions) {
    return regions
        .slice()
        .sort(compareRegions);
}

function incrementRegionUsage(code) {
    if (!REGION_BY_CODE[code])
        return;

    const currentCount = regionUsageCount(code);
    settings = normalizeSettings({
        ...settings,
        regionUsageCounts: {
            ...settings.regionUsageCounts,
            [code]: currentCount + 1
        }
    });
}

async function saveRegionUsage() {
    await extensionApi.storage.local.set({
        regionUsageCounts: settings.regionUsageCounts
    });
}

function commonRegionPreview(limit, includeSelected) {
    const regions = sortedRegions(ALL_REGIONS).slice(0, limit);

    if (!includeSelected || settings.mode !== "preset")
        return regions;

    const selectedRegion = REGION_BY_CODE[settings.region];

    if (!selectedRegion || regions.some((region) => region.code === selectedRegion.code))
        return regions;

    return sortedRegions([
        ...regions.slice(0, Math.max(0, limit - 1)),
        selectedRegion
    ]);
}

function visibleRegions({ query, filterKey, expanded, previewLimit, includeSelected }) {
    if (!query && filterKey === "all" && !expanded) {
        return {
            isPreview: true,
            regions: commonRegionPreview(previewLimit, includeSelected)
        };
    }

    const regions = ALL_REGIONS
        .filter((region) => regionMatchesFilter(region, filterKey))
        .filter((region) => regionMatchesQuery(region, query))
        .slice()
        .sort(compareRegions);

    return {
        isPreview: false,
        regions
    };
}

function makeFlagSpan(region) {
    const flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = region.flag;
    return flag;
}

function appendEmptyState(container) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = getMessage("noMatchingRegion");
    container.append(empty);
}

function renderFilterButtons(container, activeKey, onSelect) {
    container.replaceChildren();

    for (const filter of REGION_FILTERS) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = getMessage(filter.messageKey) || filter.label;
        button.dataset.filter = filter.key;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(filter.key === activeKey));
        button.addEventListener("click", () => onSelect(filter.key));
        container.append(button);
    }
}

function renderRegionSelector() {
    if (!regionEditorOpen)
        return;

    const query = normalizeSearch(regionSearchInput.value);
    const result = visibleRegions({
        query,
        filterKey: regionFilterKey,
        expanded: regionExpanded,
        previewLimit: REGION_PREVIEW_LIMIT,
        includeSelected: true
    });
    const selectedCode = selectedRegionCode();

    regionGrid.replaceChildren();

    for (const region of result.regions) {
        const button = document.createElement("button");
        const code = document.createElement("span");
        const regionName = localizedRegionName(region);

        button.type = "button";
        button.className = "region-chip";
        button.dataset.region = region.code;
        button.title = regionName;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-label", `${regionName} ${region.code.toUpperCase()}`);
        button.setAttribute("aria-checked", String(selectedCode === region.code));

        code.textContent = region.code;
        button.append(makeFlagSpan(region), code);
        button.addEventListener("click", () => selectRegion(region.code));
        regionGrid.append(button);
    }

    if (result.regions.length === 0)
        appendEmptyState(regionGrid);

    regionMoreButton.hidden = Boolean(query) || regionFilterKey !== "all";
    regionMoreButton.textContent = regionExpanded
        ? getMessage("collapseRegions")
        : getMessage("showAllRegions", String(ALL_REGIONS.length));

    renderFilterButtons(regionFilter, regionFilterKey, (filterKey) => {
        regionFilterKey = filterKey;
        regionExpanded = false;
        renderRegionSelector();
    });
}

function renderRegionEditorVisibility() {
    regionEditor.hidden = !regionEditorOpen;
    regionEditToggle.textContent = regionEditorOpen ? getMessage("doneEditing") : getMessage("editRegion");
    regionEditToggle.setAttribute("aria-expanded", String(regionEditorOpen));

    if (regionEditorOpen)
        renderRegionSelector();
}

function renderQuickRegions() {
    const query = normalizeSearch(quickSearchInput.value);
    const result = visibleRegions({
        query,
        filterKey: quickFilterKey,
        expanded: quickExpanded,
        previewLimit: QUICK_PREVIEW_LIMIT,
        includeSelected: false
    });

    quickGrid.replaceChildren();

    for (const region of result.regions) {
        const button = document.createElement("button");
        const name = document.createElement("span");
        const code = document.createElement("span");
        const regionName = localizedRegionName(region);

        button.type = "button";
        button.className = "jump-chip";
        button.dataset.region = region.code;
        button.title = regionName;

        name.className = "jump-name";
        name.textContent = regionName;
        code.className = "jump-code";
        code.textContent = region.code;

        button.append(makeFlagSpan(region), name, code);
        button.addEventListener("click", () => openQuickRegion(region.code));
        quickGrid.append(button);
    }

    if (result.regions.length === 0)
        appendEmptyState(quickGrid);

    quickMoreButton.hidden = Boolean(query) || quickFilterKey !== "all";
    quickMoreButton.textContent = quickExpanded
        ? getMessage("collapseRegions")
        : getMessage("showAllRegions", String(ALL_REGIONS.length));

    renderFilterButtons(quickFilter, quickFilterKey, (filterKey) => {
        quickFilterKey = filterKey;
        quickExpanded = false;
        renderQuickRegions();
    });
}

async function updateQuickSectionVisibility() {
    const context = await extensionApi.runtime.sendMessage({
        type: "store-fix-get-quick-jump-context"
    });

    canQuickJump = context?.canJump === true;
    quickSection.hidden = !canQuickJump;

    if (canQuickJump)
        renderQuickRegions();
    else
        toggleQuickMenu(false);
}

function renderOpenModeMenu() {
    quickMenu.querySelectorAll("[data-open-mode]").forEach((button) => {
        const isSelected = button.dataset.openMode === settings.quickOpenMode;
        button.setAttribute("aria-checked", String(isSelected));
    });
}

function renderForceOpenMode() {
    forceOpenMode.querySelectorAll("[data-force-open-mode]").forEach((button) => {
        const isSelected = button.dataset.forceOpenMode === settings.forceOpenMode;
        button.setAttribute("aria-checked", String(isSelected));
    });
}

function renderSettings(nextSettings = settings) {
    settings = normalizeSettings(nextSettings);
    enabledInput.checked = settings.enabled;

    renderOpenModeMenu();
    renderForceOpenMode();

    const targetRegion = getTargetRegion(settings);
    const region = selectedRegion();
    const flagPrefix = region?.flag ? `${region.flag} ` : "";
    currentRegionOutput.textContent = `${flagPrefix}${targetRegion.toUpperCase()}`;
    currentRegionOutput.setAttribute("aria-label", getMessage("currentFixedRegionAria", targetRegion.toUpperCase()));
    renderRegionEditorVisibility();
}

function selectRegion(code) {
    settings = normalizeSettings({
        ...settings,
        mode: "preset",
        region: code
    });
    incrementRegionUsage(code);
    regionEditorOpen = false;
    regionExpanded = false;
    regionFilterKey = "all";
    regionSearchInput.value = "";
    renderSettings(settings);
    queueSave();
}

function getFormSettings() {
    return normalizeSettings({
        ...settings,
        enabled: enabledInput.checked
    });
}

async function saveSettings() {
    const formSettings = getFormSettings();

    if (!formSettings) {
        setStatus(getMessage("invalidRegionCode"), true);
        return false;
    }

    settings = formSettings;
    await extensionApi.storage.local.set({
        enabled: settings.enabled,
        mode: settings.mode,
        region: settings.region,
        customRegion: settings.customRegion,
        quickOpenMode: settings.quickOpenMode,
        forceOpenMode: settings.forceOpenMode,
        forceNewWindow: settings.forceNewWindow,
        regionUsageCounts: settings.regionUsageCounts
    });
    renderSettings(settings);
    clearStatus();
    return true;
}

function queueSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        saveSettings().catch((error) => {
            setStatus(error.message, true);
        });
    }, 120);
}

function toggleQuickMenu(forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : quickMenu.hidden;
    quickMenu.hidden = !shouldOpen;
    quickSettingsButton.setAttribute("aria-expanded", String(shouldOpen));
}

async function setOpenMode(openMode) {
    settings = normalizeSettings({
        ...settings,
        quickOpenMode: openMode
    });

    await extensionApi.storage.local.set({ quickOpenMode: settings.quickOpenMode });
    renderOpenModeMenu();
    toggleQuickMenu(false);
    clearStatus();
}

async function openQuickRegion(region) {
    if (!canQuickJump) {
        setStatus(getMessage("notAppStoreAppLink"), true);
        return;
    }

    const result = await extensionApi.runtime.sendMessage({
        type: "store-fix-open-quick-jump",
        region,
        openMode: settings.quickOpenMode
    });

    if (result?.changed) {
        incrementRegionUsage(region);
        await saveRegionUsage();
        clearStatus();
        closePopup();
        return;
    }

    setStatus(getMessage("notAppStoreAppLink"), true);
}

async function loadSettings() {
    const storedSettings = await extensionApi.storage.local.get(DEFAULT_SETTINGS);
    renderSettings(storedSettings);
    await updateQuickSectionVisibility();
}

enabledInput.addEventListener("change", queueSave);

forceOpenMode.querySelectorAll("[data-force-open-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        settings = normalizeSettings({
            ...settings,
            forceOpenMode: button.dataset.forceOpenMode
        });
        renderForceOpenMode();
        queueSave();
    });
});

regionSearchInput.addEventListener("input", renderRegionSelector);

regionMoreButton.addEventListener("click", () => {
    regionExpanded = !regionExpanded;
    renderRegionSelector();
});

regionEditToggle.addEventListener("click", () => {
    regionEditorOpen = !regionEditorOpen;
    renderRegionEditorVisibility();

    if (regionEditorOpen)
        regionSearchInput.focus();
});

quickSearchInput.addEventListener("input", renderQuickRegions);

quickMoreButton.addEventListener("click", () => {
    quickExpanded = !quickExpanded;
    renderQuickRegions();
});

quickSettingsButton.addEventListener("click", () => {
    toggleQuickMenu();
});

quickMenu.querySelectorAll("[data-open-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        setOpenMode(button.dataset.openMode).catch((error) => {
            setStatus(error.message, true);
        });
    });
});

document.addEventListener("click", (event) => {
    if (quickMenu.hidden)
        return;

    if (event.target === quickSettingsButton || quickMenu.contains(event.target))
        return;

    toggleQuickMenu(false);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
        toggleQuickMenu(false);
});

applyLocalization();
loadSettings().catch((error) => {
    quickSection.hidden = true;
    setStatus(error.message, true);
});
