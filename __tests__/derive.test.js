/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const sharp = require("sharp");

const {
    deriveFromMaster,
    renditionKey,
    renditionLabel,
    RENDITION_WIDTHS,
} = require("../src/lib/media/derive.ts");

function solid(width, height, extra = {}) {
    return sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 40, g: 90, b: 140 },
        },
    })
        .jpeg(extra)
        .toBuffer();
}

(async () => {
    assert.equal(renditionLabel("avif", 800), "avif-800");
    assert.equal(renditionKey("my-slug", 800, "avif"), "derived/photo/my-slug/800.avif");

    // --- a master wider than every configured width -------------------------
    {
        const master = await solid(3000, 2000);
        const result = await deriveFromMaster(master);

        assert.equal(result.width, 3000);
        assert.equal(result.height, 2000);
        // 2400 is the largest width at or below 3000, so all four are emitted,
        // in both formats.
        assert.equal(result.renditions.length, RENDITION_WIDTHS.length * 2);

        for (const width of RENDITION_WIDTHS) {
            for (const format of ["avif", "webp"]) {
                const hit = result.renditions.find((r) => r.label === `${format}-${width}`);
                assert.ok(hit, `expected a ${format}-${width} rendition`);
                assert.equal(hit.width, width);
                assert.ok(hit.bytes.length > 0);
            }
        }

        assert.ok(result.lqip.startsWith("data:image/webp;base64,"));
        // The LQIP travels inside the catalog artifact, so its size is a budget,
        // not an incidental detail.
        assert.ok(result.lqip.length < 4000, `lqip unexpectedly large: ${result.lqip.length}`);
    }

    // --- widths above native are skipped, never upscaled ---------------------
    {
        const master = await solid(1000, 700);
        const result = await deriveFromMaster(master);

        const widths = [...new Set(result.renditions.map((r) => r.width))].sort((a, b) => a - b);
        assert.deepEqual(widths, [400, 800], "should skip 1600 and 2400 for a 1000px master");
        for (const rendition of result.renditions) {
            assert.ok(rendition.width <= 1000, "no rendition may exceed the master width");
        }
    }

    // --- a master narrower than the smallest width still yields output -------
    {
        const master = await solid(220, 160);
        const result = await deriveFromMaster(master);

        assert.equal(result.renditions.length, 2, "one per format at native width");
        for (const rendition of result.renditions) {
            assert.equal(rendition.width, 220);
        }
    }

    // --- EXIF orientation 6 transposes the reported dimensions --------------
    {
        // Orientation 6 is a 90-degree rotation, so a 1200x800 file renders as
        // 800x1200. Reporting the header values here would transpose every
        // layout computed from them.
        const master = await sharp({
            create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 10, b: 10 } },
        })
            // withExifMerge does not populate the orientation sharp reads back;
            // withMetadata is the field that round-trips.
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();

        const result = await deriveFromMaster(master);

        assert.equal(result.rawWidth, 1200, "raw width is what the header claims");
        assert.equal(result.rawHeight, 800);
        assert.equal(result.width, 800, "measured width accounts for the rotation");
        assert.equal(result.height, 1200);

        // The encoded output must be rotated too, not merely described as such.
        const largest = result.renditions
            .filter((r) => r.format === "webp")
            .sort((a, b) => b.width - a.width)[0];
        assert.ok(largest.height > largest.width, "rendition should be portrait after rotation");
    }

    console.log("derive.test.js ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
