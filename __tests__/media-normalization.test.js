/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");

const { classifyStorageObject, slugFromText } = require("../src/lib/media/normalization.ts");

(async () => {
  const invalid = classifyStorageObject({
    key: "raw/file.bin",
    mimeType: "application/octet-stream",
    sizeBytes: 120,
  });
  assert.equal(invalid.outcome, "invalid");

  const validImage = classifyStorageObject({
    key: "images/harbor-sunset.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  });
  assert.equal(validImage.outcome, "valid");
  assert.equal(validImage.mediaType, "image");
  assert.equal(slugFromText("Harbor Sunset 2026"), "harbor-sunset-2026");

  const warningVideo = classifyStorageObject({
    key: "videos/launch.mp4",
    mimeType: "video/mp4",
    sizeBytes: 0,
  });
  assert.equal(warningVideo.outcome, "warning");
  assert.ok(warningVideo.warnings.some((warning) => warning.includes("size")));

  console.log("media-normalization.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
