// Edge function

export const runtime = "nodejs";

import { verifyS3OnStartup } from "@/lib/s3-check";


// Runs once per server process (dev may re-run on HMR)
export async function register() {
    // Edge functions
    await verifyS3OnStartup();
}
