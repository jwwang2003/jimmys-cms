// Edge function

import { verifyS3OnStartup } from "@/lib/s3-check";

// Runs once per server process (dev may re-run on HMR)
export async function register() {
    await verifyS3OnStartup();
}