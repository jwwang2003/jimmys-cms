/**
 * S3 connectivity test
 * - Loads env via jest.setup-env.js
 * - Skips if @aws-sdk/client-s3 is not installed
 * - Requires S3_BUCKET; region/credentials come from env or AWS shared config
 * - When enabled, performs a HeadBucket to verify access
 */

const missingEnv = ["S3_BUCKET"].filter((k) => !process.env[k]);

let hasSdk = false;
try {
  require.resolve("@aws-sdk/client-s3");
  hasSdk = true;
} catch (_) {
  // leave hasSdk = false
}

if (missingEnv.length > 0) {
  // Provide a helpful message in the console
  // Jest will mark as skipped via test.skip below
  // eslint-disable-next-line no-console
  console.warn(
    `Skipping S3 connectivity test: missing env vars ${missingEnv.join(", ")}`
  );
}

if (!hasSdk) {
  // eslint-disable-next-line no-console
  console.warn(
    "Skipping S3 connectivity test: @aws-sdk/client-s3 is not installed. Install it with `pnpm add -D @aws-sdk/client-s3` or `npm i -D @aws-sdk/client-s3`."
  );
}

const maybeTest = missingEnv.length === 0 && hasSdk ? test : test.skip;

maybeTest(
  "connects to S3 bucket via HeadBucket",
  async () => {
    const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");

    const bucket = process.env.S3_BUCKET;
    // Let AWS SDK pick up credentials and region from env/IMDS/shared config
    const client = new S3Client({ region: process.env.AWS_REGION });

    // Try resolving region and credentials first to provide a clearer skip
    let resolvedRegion;
    try {
      resolvedRegion = await client.config.region();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping: could not resolve AWS region. Set AWS_REGION or AWS_PROFILE. Details: ${e?.message || e}`
      );
      return; // treat as skipped
    }

    try {
      const credsProvider = client.config.credentials;
      const creds = typeof credsProvider === "function" ? await credsProvider() : credsProvider;
      if (!creds || !creds.accessKeyId) {
        // eslint-disable-next-line no-console
        console.warn(
          "Skipping: credentials not available. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE."
        );
        return; // treat as skipped
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping: could not load AWS credentials. Set AWS_PROFILE or keys. Details: ${e?.message || e}`
      );
      return; // treat as skipped
    }

    // If the call succeeds, we have network + valid creds/permissions for the bucket
    await expect(
      client.send(new HeadBucketCommand({ Bucket: bucket }))
    ).resolves.toBeDefined();
  },
  20000
);
