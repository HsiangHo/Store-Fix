const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const resourceDirectories = [
    "chrome-extension",
    "Store Fix/Shared (Extension)/Resources"
];
const targetUrl = "https://apps.apple.com/hk/app/x/id333903271?l=zh-Hant&mt=12#details";
const macNavigator = { platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 0 };

for (const directory of resourceDirectories) {
    const readResource = (name) => readFileSync(path.join(__dirname, "..", directory, name), "utf8");
    const urlScript = readResource("app-store-url.js");
    const pageScript = readResource("region-failed.js");
    const urlContext = vm.createContext({ URL });
    vm.runInContext(urlScript, urlContext);
    const { getNativeAppStoreUrl } = urlContext.StoreFixUrl;

    function loadPage({
        navigator = macNavigator, params = {}, messages = {}, response = {},
        copyResult, clipboardAvailable = true
    } = {}) {
        const elements = Object.fromEntries([
            "#heading", "#description", "#target-url", "#continue-button", "#open-app-store-button",
            "#copy-url-button", "#copy-tooltip", "#copy-status"
        ].map((selector) => [selector, {
            hidden: selector === "#continue-button" || selector === "#open-app-store-button",
            disabled: false,
            dataset: {},
            attributes: {},
            listeners: {},
            setAttribute(name, value) {
                this.attributes[name] = value;
            },
            addEventListener(type, listener) {
                this.listeners[type] = listener;
            }
        }]));
        const sentMessages = [];
        const navigations = [];
        const clipboardWrites = [];
        const timers = new Map();
        let timerId = 0;
        const clipboard = {
            async writeText(text) {
                clipboardWrites.push(text);
                if (copyResult instanceof Error)
                    throw copyResult;
                await copyResult;
            }
        };
        const context = vm.createContext({
            URL,
            URLSearchParams,
            navigator: { ...navigator, ...(clipboardAvailable ? { clipboard } : {}) },
            console: { error() {} },
            document: { querySelector: (selector) => elements[selector] },
            window: {
                setTimeout(callback, delay) {
                    timers.set(++timerId, { callback, delay });
                    return timerId;
                },
                clearTimeout(id) {
                    timers.delete(id);
                },
                location: {
                    search: `?${new URLSearchParams({ targetRegion: "HK", sourceRegion: "CN", targetUrl, ...params })}`,
                    assign: (url) => navigations.push(url)
                }
            },
            chrome: {
                i18n: { getMessage: (name) => messages[name]?.message ?? "" },
                runtime: {
                    async sendMessage(message) {
                        sentMessages.push({ ...message });
                        if (response instanceof Error)
                            throw response;
                        return response;
                    }
                }
            }
        });
        vm.runInContext(urlScript, context);
        vm.runInContext(pageScript, context);
        return { elements, sentMessages, navigations, clipboard, clipboardWrites, timers };
    }

    test(`${directory}: copying writes only the full target URL and resets success feedback`, async () => {
        const { elements, clipboardWrites, timers } = loadPage();
        const button = elements["#copy-url-button"];
        assert.deepEqual(clipboardWrites, []);
        assert.equal(button.dataset.state, "idle");
        assert.equal(button.attributes["aria-label"], "Copy URL");
        assert.equal(button.disabled, false);

        await button.listeners.click();
        assert.deepEqual(clipboardWrites, [targetUrl]);
        assert.equal(button.dataset.state, "copied");
        assert.equal(button.attributes["aria-label"], "Copied");
        assert.equal(button.attributes["aria-busy"], "false");
        assert.equal(button.disabled, false);
        assert.equal(elements["#copy-tooltip"].textContent, "Copied");
        assert.equal(elements["#copy-status"].textContent, "Copied");
        assert.equal(timers.size, 1);

        const [timer] = timers.values();
        assert.equal(timer.delay, 2000);
        timer.callback();
        assert.equal(button.dataset.state, "idle");
        assert.equal(button.attributes["aria-label"], "Copy URL");
        assert.equal(elements["#copy-tooltip"].textContent, "Copy URL");
        assert.equal(elements["#copy-status"].textContent, "");
    });

    test(`${directory}: copying is disabled when the target URL is missing`, async () => {
        const { elements, clipboardWrites, timers } = loadPage({ params: { targetUrl: "" } });
        const button = elements["#copy-url-button"];
        assert.equal(button.disabled, true);
        await button.listeners.click();
        assert.deepEqual(clipboardWrites, []);
        assert.equal(timers.size, 0);
    });

    test(`${directory}: copy errors show retry feedback and recover on the next click`, async () => {
        const { elements, clipboard, clipboardWrites, timers } = loadPage({ copyResult: new Error("NotAllowedError") });
        const button = elements["#copy-url-button"];
        await button.listeners.click();
        assert.equal(button.dataset.state, "error");
        assert.equal(button.disabled, false);
        assert.equal(elements["#copy-status"].textContent, "Copy failed. Try again.");
        assert.equal(elements["#copy-tooltip"].textContent, "Copy failed. Try again.");
        const [oldTimerId] = timers.keys();

        clipboard.writeText = async (text) => clipboardWrites.push(text);
        await button.listeners.click();
        assert.equal(button.dataset.state, "copied");
        assert.deepEqual(clipboardWrites, [targetUrl, targetUrl]);
        assert.equal(timers.has(oldTimerId), false);
        assert.equal(timers.size, 1);
    });

    test(`${directory}: missing clipboard API never reports success`, async () => {
        const { elements } = loadPage({ clipboardAvailable: false });
        const button = elements["#copy-url-button"];
        await button.listeners.click();
        assert.equal(button.dataset.state, "error");
        assert.equal(button.disabled, false);
        assert.equal(elements["#copy-status"].textContent, "Copy failed. Try again.");
    });

    test(`${directory}: an in-flight copy cannot be duplicated`, async () => {
        let resolveCopy;
        const copyResult = new Promise((resolve) => { resolveCopy = resolve; });
        const { elements, clipboardWrites } = loadPage({ copyResult });
        const button = elements["#copy-url-button"];
        const pendingCopy = button.listeners.click();
        assert.equal(button.disabled, true);
        assert.equal(button.attributes["aria-busy"], "true");
        assert.equal(button.dataset.state, "copying");
        await button.listeners.click();
        assert.deepEqual(clipboardWrites, [targetUrl]);

        resolveCopy();
        await pendingCopy;
        assert.equal(button.dataset.state, "copied");
        assert.equal(button.disabled, false);
    });

    test(`${directory}: repeated copying restarts the feedback timer`, async () => {
        const { elements, clipboardWrites, timers } = loadPage();
        const button = elements["#copy-url-button"];
        await button.listeners.click();
        const [oldTimerId] = timers.keys();
        await button.listeners.click();
        assert.deepEqual(clipboardWrites, [targetUrl, targetUrl]);
        assert.equal(timers.has(oldTimerId), false);
        assert.equal(timers.size, 1);
        assert.equal(button.dataset.state, "copied");
    });

    test(`${directory}: copy labels and result feedback are localized`, async () => {
        for (const locale of ["en", "zh_CN", "zh_TW"]) {
            const messages = JSON.parse(readResource(`_locales/${locale}/messages.json`));
            for (const copyResult of [undefined, new Error("Denied")]) {
                const { elements } = loadPage({ messages, copyResult });
                const button = elements["#copy-url-button"];
                const label = messages.redirectFailedCopyButton.message;
                assert.ok(label);
                assert.equal(button.attributes["aria-label"], label);
                assert.equal(elements["#copy-tooltip"].textContent, label);
                await button.listeners.click();
                const resultLabel = messages[copyResult ? "redirectFailedCopyError" : "redirectFailedCopied"].message;
                assert.ok(resultLabel);
                assert.equal(button.attributes["aria-label"], resultLabel);
                assert.equal(elements["#copy-status"].textContent, resultLabel);
            }
        }
    });

    test(`${directory}: native URLs preserve the target storefront and app details`, () => {
        assert.equal(getNativeAppStoreUrl(targetUrl, "mac"), targetUrl.replace("https:", "macappstore:"));
        assert.equal(getNativeAppStoreUrl(targetUrl, "ios"), targetUrl.replace("https:", "itms-apps:"));
        for (const protocol of ["http:", "itms-apps:", "itms-appss:"]) {
            assert.equal(
                getNativeAppStoreUrl(targetUrl.replace("https:", protocol), "mac"),
                targetUrl.replace("https:", "macappstore:")
            );
        }
        assert.equal(
            getNativeAppStoreUrl("https://apps.apple.com/jp/app/%E3%82%A2%E3%83%97%E3%83%AA/id123", "ios"),
            "itms-apps://apps.apple.com/jp/app/%E3%82%A2%E3%83%97%E3%83%AA/id123"
        );
    });

    test(`${directory}: invalid destinations and unsupported platforms are rejected`, () => {
        for (const url of [
            "", "not a URL", "/hk/app/x/id333903271",
            "javascript:alert(1)", "file://apps.apple.com/hk/app/id123",
            "https://example.com/hk/app/id123",
            "https://apps.apple.com.evil.example/hk/app/id123",
            "https://apps.apple.com@evil.example/hk/app/id123",
            "https://user:password@apps.apple.com/hk/app/id123",
            "https://apps.apple.com:8080/hk/app/id123"
        ]) {
            assert.equal(getNativeAppStoreUrl(url, "mac"), null, url);
            const { elements } = loadPage({ params: { targetUrl: url } });
            assert.equal(elements["#open-app-store-button"].hidden, true, url);
            assert.equal(elements["#open-app-store-button"].href, undefined, url);
        }
        for (const platform of ["win", "linux", "android", "", undefined])
            assert.equal(getNativeAppStoreUrl(targetUrl, platform), null);
    });

    for (const [name, navigator, protocol] of [
        ["Mac", macNavigator, "macappstore:"],
        ["Mac client hints", { platform: "", userAgent: "", userAgentData: { platform: "macOS" } }, "macappstore:"],
        ["Mac user agent", { platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, "macappstore:"],
        ["iPhone", { platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone)" }, "itms-apps:"],
        ["iPad", { platform: "iPad", userAgent: "Mozilla/5.0 (iPad)" }, "itms-apps:"],
        ["iPad desktop mode", { ...macNavigator, maxTouchPoints: 5 }, "itms-apps:"],
        ["Windows", { platform: "Win32", userAgent: "Windows NT 10.0" }, null],
        ["Linux", { platform: "Linux x86_64", userAgent: "X11; Linux x86_64" }, null],
        ["Android", { platform: "Linux armv8l", userAgent: "Linux; Android" }, null]
    ]) {
        test(`${directory}: failure page on ${name}`, () => {
            const { elements, sentMessages, navigations } = loadPage({ navigator });
            const button = elements["#open-app-store-button"];
            assert.equal(button.hidden, !protocol);
            assert.equal(button.href, protocol ? targetUrl.replace("https:", protocol) : undefined);
            if (protocol)
                assert.equal(button.textContent, "Open in App Store");
            assert.deepEqual(sentMessages, []);
            assert.deepEqual(navigations, []);
            assert.equal(elements["#continue-button"].hidden, false);
        });
    }

    test(`${directory}: all supported locales have a native-open label`, () => {
        for (const [locale, label] of [
            ["en", "Open in App Store"],
            ["zh_CN", "\u5728 App Store \u4e2d\u6253\u5f00"],
            ["zh_TW", "\u5728 App Store \u4e2d\u958b\u555f"]
        ]) {
            const messages = JSON.parse(readResource(`_locales/${locale}/messages.json`));
            const { elements } = loadPage({ messages });
            assert.equal(elements["#open-app-store-button"].textContent, label);
        }
    });

    test(`${directory}: native open does not require a source region`, () => {
        const { elements } = loadPage({ params: { sourceRegion: "" } });
        assert.equal(elements["#open-app-store-button"].hidden, false);
        assert.equal(elements["#continue-button"].hidden, true);
    });

    test(`${directory}: continuing with the source region still works`, async () => {
        for (const response of [{ changed: true }, { url: "https://apps.apple.com/cn/app/x/id333903271" }, {}, new Error("Unavailable")]) {
            const { elements, sentMessages, navigations } = loadPage({ response });
            const button = elements["#continue-button"];
            await button.listeners.click();
            assert.deepEqual(sentMessages, [{
                type: "store-fix-continue-source-region",
                sourceRegion: "CN",
                targetUrl
            }]);
            assert.deepEqual(navigations, response.url ? [response.url] : []);
            assert.equal(button.disabled, Boolean(response.changed || response.url));
            assert.equal(elements["#open-app-store-button"].href, targetUrl.replace("https:", "macappstore:"));
        }
    });

    test(`${directory}: failure page loads URL helpers before initialization`, () => {
        const html = readResource("region-failed.html");
        const helperIndex = html.indexOf('<script defer src="app-store-url.js">');
        assert.ok(helperIndex >= 0);
        assert.ok(helperIndex < html.indexOf('<script defer src="region-failed.js">'));
        assert.match(html, /<a id="open-app-store-button" class="button" hidden>/);
    });
}

test("Chrome and Safari share the same native-open implementation", () => {
    for (const name of ["app-store-url.js", "region-failed.js", "region-failed.html"]) {
        const copies = resourceDirectories.map((directory) =>
            readFileSync(path.join(__dirname, "..", directory, name), "utf8"));
        assert.equal(copies[0], copies[1], name);
    }
});
