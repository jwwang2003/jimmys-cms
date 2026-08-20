import { createAuthClient } from "better-auth/react";

// Base URL of the auth server. Must be inlined at build time for the browser
// bundle, hence NEXT_PUBLIC_. Falls back to a same-origin client (baseURL
// undefined) so a deployment that forgets the var still works rather than
// pointing every visitor at localhost.
const baseURL = process.env.NEXT_PUBLIC_AUTH_BASE_URL || undefined;

export const authClient = createAuthClient({ baseURL });
