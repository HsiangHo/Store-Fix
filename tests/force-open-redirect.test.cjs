const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const directory = "Store Fix/Shared (Extension)/Resources";
const extensionBase = "safari-web-extension://ABCDEF12-3456/";
const readResource = (name) => readFileSync(path.join(__dirname, "..", directory, name), "utf8");

function loadBackground(settings = {}) {
    const addListener = () => {};
    const storage = { enabled: true, mode: "preset", region: "cn", forceOpenMode: "new-tab", ...settings };
    const dynamicRuleUpdates = [];
    const context = vm.createContext({
        URL,
        URLSearchParams,
        console,
        setTimeout,
        clearTimeout,
        navigator: { platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 0 },
        browser: {
            runtime: {
                getURL: (file) => `${extensionBase}${file}`,
                getPlatformInfo: async () => ({ os: "mac" }),
                onInstalled: { addListener },
                onMessage: { addListener }
            },
            storage: {
                local: {
                    async get(defaults) {
                        return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, storage[key] ?? value]));
                    },
                    async set(values) {
                        Object.assign(storage, values);
                    }
                },
                onChanged: { addListener }
            },
            declarativeNetRequest: {
                async updateEnabledRulesets() {},
                async getEnabledRulesets() { return []; },
                async updateDynamicRules(update) { dynamicRuleUpdates.push(update); }
            },
            tabs: { query: async () => [], onRemoved: { addListener } }
        }
    });

    for (const file of ["store-regions.js", "app-store-url.js", "background.js"])
        vm.runInContext(readResource(file), context, { filename: file });

    return { context, dynamicRuleUpdates, storage };
}

test("force-open mode installs a redirect rule that excludes extension and App Store initiators", async () => {
    const { context, dynamicRuleUpdates } = loadBackground();
    await vm.runInContext("requestHeaderRewriteReady", context);

    const rule = dynamicRuleUpdates.at(-1).addRules[0];
    const regex = new RegExp(rule.condition.regexFilter);
    const sourceUrl = "https://apps.apple.com/us/app/x/id333903271?l=en&mt=8#details";

    assert.deepEqual([...rule.condition.resourceTypes], ["main_frame"]);
    assert.deepEqual([...rule.condition.excludedInitiatorDomains], ["apps.apple.com", "abcdef12-3456"]);
    assert.equal(
        sourceUrl.replace(regex, rule.action.redirect.regexSubstitution.replace("\\1", "$1")),
        `${extensionBase}force-open.html?source=redirect#${sourceUrl}`
    );
    assert.equal(regex.test("https://apps.apple.com.evil.example/"), false);
});

test("the redirect rule is removed when force-open mode or the extension is off", async () => {
    for (const settings of [{ forceOpenMode: "off" }, { enabled: false }]) {
        const { context, dynamicRuleUpdates } = loadBackground(settings);
        await vm.runInContext("requestHeaderRewriteReady", context);

        assert.deepEqual([...dynamicRuleUpdates.at(-1).removeRuleIds], [1]);
        assert.equal(dynamicRuleUpdates.at(-1).addRules.length, 0);
    }
});

test("redirected navigations resolve to the fixed region and bypass the next auto redirect", async () => {
    const { context, storage } = loadBackground();
    const result = await context.prepareRedirectedNavigation({ tab: { id: 7 } }, "https://apps.apple.com/us/app/x/id333903271?l=en");

    assert.equal(result.url, "https://apps.apple.com/cn/app/x/id333903271?l=en");
    assert.equal(storage.manualJumpUrl, result.url);
    assert.equal(context.StoreFixUrl.shouldBypassAutoRedirect(result.url, storage), true);
});

function runForceOpen(href, { response, session = {} } = {}) {
    const replaced = [];
    const sent = [];
    const fallbackLink = { href: "" };
    const url = new URL(href);
    const context = vm.createContext({
        URL,
        URLSearchParams,
        JSON,
        Date,
        console,
        document: { querySelector: () => fallbackLink },
        sessionStorage: {
            getItem: (key) => session[key] ?? null,
            setItem: (key, value) => { session[key] = value; }
        },
        browser: {
            runtime: {
                async sendMessage(message) {
                    sent.push(message);
                    return response;
                }
            }
        },
        window: {
            location: { search: url.search, hash: url.hash, replace: (next) => replaced.push(next) },
            setTimeout: (callback) => { context.pending = callback(); }
        }
    });

    vm.runInContext(readResource("app-store-url.js"), context);
    vm.runInContext(readResource("force-open.js"), context);
    return { context, fallbackLink, replaced, sent, session };
}

test("force-open page follows the background target for redirected navigations", async () => {
    const sourceUrl = "https://apps.apple.com/us/app/x/id333903271?l=en&mt=8#details";
    const targetUrl = "https://apps.apple.com/cn/app/x/id333903271?l=en&mt=8#details";
    const { context, replaced, sent } = runForceOpen(`${extensionBase}force-open.html?source=redirect#${sourceUrl}`, {
        response: { url: targetUrl }
    });
    await context.pending;

    assert.equal(sent[0].type, "store-fix-prepare-redirected-navigation");
    assert.equal(sent[0].url, sourceUrl);
    assert.deepEqual(replaced, [targetUrl]);
});

test("force-open page stops when the redirect rule keeps bouncing the same URL", async () => {
    const sourceUrl = "https://apps.apple.com/cn/app/x/id333903271";
    const session = {};
    const href = `${extensionBase}force-open.html?source=redirect#${sourceUrl}`;
    const replacedCounts = [];

    for (let index = 0; index < 3; index += 1) {
        const { context, replaced } = runForceOpen(href, { response: { url: sourceUrl }, session });
        await context.pending;
        replacedCounts.push(replaced.length);
    }

    assert.deepEqual(replacedCounts, [1, 1, 0]);
});

test("force-open page keeps the existing ?url= behavior", async () => {
    const targetUrl = "https://apps.apple.com/cn/app/x/id333903271?l=en&mt=8";
    const { context, replaced, sent } = runForceOpen(
        `${extensionBase}force-open.html?${new URLSearchParams({ url: targetUrl })}`
    );
    await context.pending;

    assert.equal(sent[0].type, "store-fix-register-intended-url");
    assert.deepEqual(replaced, [targetUrl]);
});
