const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const resourceDirectories = [
    "chrome-extension",
    "Store Fix/Shared (Extension)/Resources"
];
const targetUrl = "https://apps.apple.com/hk/app/x/id333903271?l=zh-Hant#details";

function loadBackground(directory, tabs, rememberedUrl = "") {
    const addListener = () => {};
    const context = vm.createContext({
        URL,
        URLSearchParams,
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
                    async get(defaults) {
                        return {
                            ...defaults,
                            redirectLoopAttempts: {
                                "tab:1": { intendedUrl: rememberedUrl, intendedUpdatedAt: Date.now() }
                            }
                        };
                    }
                },
                onChanged: { addListener }
            },
            tabs: { query: async () => tabs, onRemoved: { addListener } }
        }
    });
    for (const file of ["store-regions.js", "app-store-url.js", "background.js"]) {
        const source = readFileSync(path.join(__dirname, "..", directory, file), "utf8");
        vm.runInContext(source, context, { filename: file });
    }
    return context;
}

for (const directory of resourceDirectories) {
    test(`${directory}: popup context distinguishes the current URL from a remembered region`, async () => {
        const activeUrl = "https://apps.apple.com/us/app/x/id333903271?l=en";
        const context = loadBackground(directory, [{ id: 1, url: activeUrl }], targetUrl);
        const result = await context.getQuickJumpContext();
        assert.equal(result.canJump, true);
        assert.equal(result.url, targetUrl);
        assert.equal(result.activeUrl, activeUrl);
        assert.equal(
            context.StoreFixUrl.getNativeAppStoreUrl(result.activeUrl, "mac"),
            "macappstore://apps.apple.com/us/app/x/id333903271?l=en"
        );
    });

    test(`${directory}: ordinary pages cannot supply a native link even with remembered intent`, async () => {
        const context = loadBackground(directory, [{ id: 1, url: "https://example.com/" }], targetUrl);
        const result = await context.getQuickJumpContext();
        assert.equal(result.url, targetUrl);
        assert.equal(result.activeUrl, "https://example.com/");
        assert.equal(context.StoreFixUrl.getNativeAppStoreUrl(result.activeUrl, "mac"), null);
    });

    test(`${directory}: the failure page is not treated as the active App Store URL`, async () => {
        const activeUrl = `https://extension.example/region-failed.html?${new URLSearchParams({ targetUrl })}`;
        const context = loadBackground(directory, [{ id: 1, url: activeUrl }]);
        const result = await context.getQuickJumpContext();
        assert.equal(result.url, targetUrl);
        assert.equal(result.activeUrl, activeUrl);
        assert.equal(context.StoreFixUrl.getNativeAppStoreUrl(result.activeUrl, "mac"), null);
    });

    test(`${directory}: missing tabs and missing URLs provide no native link`, async () => {
        for (const tabs of [[], [{ id: 1 }]]) {
            const context = loadBackground(directory, tabs);
            const result = await context.getQuickJumpContext();
            assert.equal(result.canJump, false);
            assert.equal(context.StoreFixUrl.getNativeAppStoreUrl(result.activeUrl, "mac"), null);
        }
    });
}
