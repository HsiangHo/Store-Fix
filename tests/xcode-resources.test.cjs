const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const resourcesDirectory = path.join(root, "Store Fix/Shared (Extension)/Resources");
const project = readFileSync(path.join(root, "Store Fix/Store Fix.xcodeproj/project.pbxproj"), "utf8");
const extensionTargets = ["Store Fix Extension (iOS)", "Store Fix Extension (macOS)"];

function getMembershipExceptions(targetName) {
    const pattern = new RegExp(
        `Exceptions for "Shared \\(Extension\\)" folder in "${targetName.replace(/[()]/g, "\\$&")}" target \\*/ = \\{[\\s\\S]*?membershipExceptions = \\(([\\s\\S]*?)\\);`
    );
    const match = project.match(pattern);
    assert.ok(match, `Missing membership exceptions for ${targetName}`);

    return new Set(match[1].split(",").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean));
}

function getReferencedResources() {
    const manifest = JSON.parse(readFileSync(path.join(resourcesDirectory, "manifest.json"), "utf8"));
    const files = new Set([
        "manifest.json",
        ...manifest.background.scripts,
        ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
        manifest.action.default_popup
    ]);

    for (const name of readdirSync(resourcesDirectory).filter((file) => file.endsWith(".html"))) {
        files.add(name);

        const html = readFileSync(path.join(resourcesDirectory, name), "utf8");

        for (const [, src] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.(?:js|css))"/g))
            files.add(src);
    }

    return [...files];
}

for (const targetName of extensionTargets) {
    test(`${targetName} bundles every resource the extension loads`, () => {
        const members = getMembershipExceptions(targetName);
        const missing = getReferencedResources().filter((file) => {
            const topLevel = file.split("/")[0];
            return !members.has(`Resources/${file}`) && !members.has(`Resources/${topLevel}`);
        });

        assert.deepEqual(missing, []);
    });
}
