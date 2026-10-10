const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const resourceDirectories = [
    "chrome-extension",
    "Store Fix/Shared (Extension)/Resources"
];
const sourceUrl = "https://apps.apple.com/us/app/x/id333903271?mt=8&l=en-US#details";

function makePage(language, links = [], hasFooter = true) {
    return {
        documentElement: { lang: language },
        querySelector: () => hasFooter ? {
            querySelectorAll: () => links.map(({ href, label, dialog = false }) => ({
                getAttribute: () => href,
                textContent: label,
                closest: () => dialog ? {} : null
            }))
        } : null
    };
}

function loadResources(directory, { activeUrl = sourceUrl, forceOpenMode = "off", queriedUrl = activeUrl } = {}) {
    const updates = [];
    const stored = { region: "cn", forceOpenMode };
    const addListener = () => {};
    const context = vm.createContext({
        URL,
        URLSearchParams,
        Intl,
        console,
        navigator: { platform: "MacIntel", userAgent: "Macintosh" },
        chrome: {
            runtime: {
                getURL: (file) => `https://extension.example/${file}`,
                getPlatformInfo: async () => ({ os: "mac" }),
                onInstalled: { addListener },
                onMessage: { addListener }
            },
            storage: {
                local: {
                    get: async (defaults) => ({ ...defaults, ...stored }),
                    set: async (values) => Object.assign(stored, values)
                },
                onChanged: { addListener }
            },
            tabs: {
                query: async () => [{ id: 2, url: queriedUrl }],
                get: async (id) => ({ id, url: activeUrl }),
                update: async (tabId, values) => updates.push({ tabId, ...values }),
                onRemoved: { addListener }
            }
        }
    });

    for (const file of ["store-regions.js", "app-store-url.js", "app-store-languages.js", "background.js"]) {
        vm.runInContext(readFileSync(path.join(__dirname, "..", directory, file), "utf8"), context, { filename: file });
    }

    return { context, updates, stored };
}

for (const directory of resourceDirectories) {
    test(`${directory}: page languages come from the footer and exclude other regions, dialogs, and duplicate links`, () => {
        const { context } = loadResources(directory);
        const result = context.StoreFixLanguages.readPageLanguages(makePage("en-US", [
            { href: "?l=zh-Hans-CN", label: "简体中文" },
            { href: "?l=ar", label: "العربية" },
            { href: "?l=ZH-HANS-CN", label: "Duplicate" },
            { href: "?l=en-US", label: "Current language" },
            { href: "/ca/app/x/id333903271?l=fr-CA", label: "Other storefront" },
            { href: "/us/app/another/id123?l=fr-FR", label: "Other app" },
            { href: "https://example.com/us/app/x/id333903271?l=fr-FR", label: "Other host" },
            { href: "?l=ko", label: "Modal only", dialog: true },
            { href: "?l=invalid_language", label: "Invalid locale" },
            { href: "?l=ru", label: "   " }
        ]), sourceUrl);

        assert.deepEqual(Array.from(result.languages, (language) => language.code), ["en-US", "zh-Hans-CN", "ar"]);
        assert.equal(result.languages[0].selected, true);
        assert.equal(result.languages[1].label, "简体中文");
        assert.equal(result.languages[1].url, sourceUrl.replace("en-US", "zh-Hans-CN"));
    });

    test(`${directory}: selected languages use the rendered locale and allow returning to English`, () => {
        const { context } = loadResources(directory);
        const result = context.StoreFixLanguages.readPageLanguages(makePage("zh-Hans-CN", [
            { href: "?l=en-US", label: "English (United States)" },
            { href: "?l=es-MX", label: "Español (México)" }
        ]), sourceUrl.replace("en-US", "zh-Hans"));
        assert.equal(result.languages[0].code, "zh-Hans-CN");
        assert.equal(result.languages[0].selected, true);
        assert.equal(result.languages[1].code, "en-US");
        assert.equal(result.languages[1].selected, false);
    });

    test(`${directory}: missing footer and invalid destinations provide no languages`, () => {
        const { context } = loadResources(directory);
        assert.equal(context.StoreFixLanguages.readPageLanguages(makePage("en-US", [], false), sourceUrl).languages.length, 0);
        for (const rawUrl of ["https://example.com/", "javascript:alert(1)", "https://user:pass@apps.apple.com/us/app/id123", "http://apps.apple.com/us/app/id123"]) {
            assert.equal(context.StoreFixLanguages.readPageLanguages(makePage("en-US"), rawUrl).languages.length, 0);
        }
        for (const language of ["", null, {}, "en_US", "en&mt=12", "javascript:alert(1)"]) {
            assert.equal(context.StoreFixLanguages.getLanguageUrl(sourceUrl, language), null);
        }
    });

    test(`${directory}: switching language preserves the current app, region, parameters, and hash despite a different fixed region`, async () => {
        const { context, updates, stored } = loadResources(directory);
        const result = await context.openPageLanguage("zh-Hant-TW", sourceUrl, 1);
        const targetUrl = sourceUrl.replace("en-US", "zh-Hant-TW");
        assert.equal(result.changed, true);
        assert.deepEqual(updates, [{ tabId: 1, url: targetUrl }]);
        assert.equal(stored.region, "cn");
        assert.equal(stored.manualJumpRegion, "us");
        assert.equal(stored.manualJumpUrl, targetUrl);
        assert.equal(context.StoreFixUrl.shouldBypassAutoRedirect(targetUrl, stored), true);
    });

    test(`${directory}: force-open mode carries the chosen language through its wrapper`, async () => {
        const { context, updates } = loadResources(directory, { forceOpenMode: "new-tab" });
        const result = await context.openPageLanguage("ar", sourceUrl, 1);
        assert.equal(result.changed, true);
        const wrapper = new URL(updates[0].url);
        assert.equal(wrapper.pathname, "/force-open.html");
        assert.equal(wrapper.searchParams.get("url"), sourceUrl.replace("en-US", "ar"));
        assert.equal(wrapper.searchParams.get("registerIntent"), "0");
    });

    test(`${directory}: a stale popup or invalid language cannot navigate the active tab`, async () => {
        const { context, updates } = loadResources(directory, { activeUrl: "https://example.com/" });
        assert.equal((await context.openPageLanguage("fr-FR", sourceUrl, 1)).changed, false);
        assert.equal(updates.length, 0);
        const current = loadResources(directory);
        assert.equal((await current.context.openPageLanguage("fr&mt=12", sourceUrl, 1)).changed, false);
        assert.equal(current.updates.length, 0);
    });

    test(`${directory}: language clicks use the popup's tab even if another tab becomes active`, async () => {
        const { context, updates } = loadResources(directory, { queriedUrl: "https://example.com/" });
        const result = await context.openPageLanguage("fr-FR", sourceUrl, 1);
        assert.equal(result.changed, true);
        assert.deepEqual(updates, [{ tabId: 1, url: sourceUrl.replace("en-US", "fr-FR") }]);
    });

    test(`${directory}: URL parameters changing while the popup is open do not block a language click`, async () => {
        const activeUrl = sourceUrl.replace("mt=8&l=en-US#details", "mt=12&l=en-US&platform=iphone#reviews");
        const { context, updates } = loadResources(directory, { activeUrl });
        const result = await context.openPageLanguage("ar", sourceUrl, 1);
        assert.equal(result.changed, true);
        assert.deepEqual(updates, [{ tabId: 1, url: activeUrl.replace("en-US", "ar") }]);
    });

    test(`${directory}: navigating to a different app or storefront invalidates the popup's language links`, async () => {
        for (const activeUrl of [
            sourceUrl.replace("id333903271", "id123"),
            sourceUrl.replace("/us/", "/ca/")
        ]) {
            const { context, updates } = loadResources(directory, { activeUrl });
            assert.equal((await context.openPageLanguage("ar", sourceUrl, 1)).changed, false);
            assert.equal(updates.length, 0);
        }
    });
}
