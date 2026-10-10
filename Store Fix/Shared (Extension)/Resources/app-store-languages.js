(() => {
    const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

    function getLanguageUrl(rawUrl, language) {
        let url;

        try {
            url = new URL(rawUrl);
        } catch {
            return null;
        }

        if (url.protocol !== "https:" || url.hostname !== "apps.apple.com"
            || url.username || url.password || url.port
            || typeof language !== "string" || !LANGUAGE_PATTERN.test(language))
            return null;

        url.searchParams.set("l", language);
        return url.toString();
    }

    function getLanguageNavigationUrl(currentUrl, sourceUrl, language) {
        const targetUrl = getLanguageUrl(currentUrl, language);

        if (!targetUrl || !getLanguageUrl(sourceUrl, language))
            return null;

        const currentPage = new URL(currentUrl);
        const sourcePage = new URL(sourceUrl);

        return currentPage.origin === sourcePage.origin && currentPage.pathname === sourcePage.pathname
            ? targetUrl
            : null;
    }

    function readPageLanguages(page, rawUrl) {
        const currentLanguage = page.documentElement?.lang?.trim() ?? "";
        const languages = [];
        const seen = new Set();
        const footer = page.querySelector("footer");

        if (!footer || !getLanguageUrl(rawUrl, currentLanguage))
            return { url: rawUrl, languages };

        let currentLabel = currentLanguage;

        try {
            currentLabel = new Intl.DisplayNames([currentLanguage], { type: "language" }).of(currentLanguage);
        } catch {
            // The page's language code remains usable when DisplayNames is unavailable.
        }

        languages.push({
            code: currentLanguage,
            label: currentLabel,
            url: getLanguageUrl(rawUrl, currentLanguage),
            selected: true
        });
        seen.add(currentLanguage.toLowerCase());
        const pageUrl = new URL(rawUrl);

        for (const anchor of footer.querySelectorAll("a[href]")) {
            if (anchor.closest("dialog, [role='dialog']"))
                continue;

            let linkUrl;

            try {
                linkUrl = new URL(anchor.getAttribute("href"), rawUrl);
            } catch {
                continue;
            }

            const code = linkUrl.searchParams.get("l");
            const label = anchor.textContent.trim();
            const url = getLanguageUrl(rawUrl, code);
            if (!url || !label || linkUrl.origin !== pageUrl.origin
                || linkUrl.pathname !== pageUrl.pathname || seen.has(code.toLowerCase()))
                continue;

            seen.add(code.toLowerCase());
            languages.push({ code, label, url, selected: false });
        }

        return { url: rawUrl, languages };
    }

    globalThis.StoreFixLanguages = Object.freeze({ getLanguageUrl, getLanguageNavigationUrl, readPageLanguages });
})();
