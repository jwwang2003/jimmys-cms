import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";

type GoogleMapsEnv = Record<string, string | undefined>;

export type GeocodeResult = {
    formattedAddress: string;
    lat: number;
    lng: number;
    placeId?: string;
    rawResponseJson: string;
};

export type GeocodeTransportContext = {
    proxyUrl: URL | null;
    timeoutMs: number;
};

export type GeocodeTransport = (url: URL, context: GeocodeTransportContext) => Promise<unknown>;

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const DEFAULT_TIMEOUT_MS = 15000;

function getApiKey(env: GoogleMapsEnv = process.env) {
    return env.GOOGLE_MAPS_API_KEY || env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

function getTimeoutMs(env: GoogleMapsEnv = process.env) {
    const parsed = Number(env.GOOGLE_MAPS_TIMEOUT_MS || env.GOOGLE_GEOCODE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return parsed;
}

function normalizeProxyUrl(rawValue: string) {
    const value = rawValue.trim();
    if (!value) return "";
    if (/^[a-z]+:\/\//i.test(value)) {
        return value;
    }
    return `http://${value}`;
}

function buildProxyAuthorization(proxyUrl: URL) {
    if (!proxyUrl.username && !proxyUrl.password) {
        return null;
    }
    const user = decodeURIComponent(proxyUrl.username);
    const pass = decodeURIComponent(proxyUrl.password);
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function wrapGoogleMapsError(error: unknown, proxyUrl: URL | null) {
    if (!(error instanceof Error)) {
        return new Error(proxyUrl ? "Google geocoding failed via proxy." : "Google geocoding failed.");
    }

    const errorCode = String((error as Error & { code?: string }).code || "");
    const timedOut =
        errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
        error.name === "TimeoutError" ||
        /timed out|timeout/i.test(error.message);

    if (timedOut) {
        const proxyHint = proxyUrl
            ? ` via proxy ${proxyUrl.host}`
            : ". Set GOOGLE_MAPS_PROXY_URL or HTTPS_PROXY if your network requires a proxy.";
        return new Error(`Google geocoding request timed out${proxyHint}`);
    }

    return error;
}

async function readJsonResponse(response: http.IncomingMessage) {
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
        response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        response.on("end", resolve);
        response.on("error", reject);
    });

    const body = Buffer.concat(chunks).toString("utf8");
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Google geocoding failed with status ${response.statusCode || 500}`);
    }

    return body ? JSON.parse(body) : {};
}

async function requestJsonWithFetch(url: URL, timeoutMs: number) {
    const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(`Google geocoding failed with status ${response.status}`);
    }
    return response.json();
}

async function createProxyTlsConnection(proxyUrl: URL, targetUrl: URL, timeoutMs: number) {
    const transport = proxyUrl.protocol === "https:" ? https : http;
    const targetPort = Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80));
    const headers: Record<string, string> = {
        Host: `${targetUrl.hostname}:${targetPort}`,
    };
    const authHeader = buildProxyAuthorization(proxyUrl);
    if (authHeader) {
        headers["Proxy-Authorization"] = authHeader;
    }

    return await new Promise<tls.TLSSocket>((resolve, reject) => {
        let settled = false;
        const finish = (error: Error | null, socket?: tls.TLSSocket) => {
            if (settled) return;
            settled = true;
            if (error) {
                reject(error);
                return;
            }
            resolve(socket as tls.TLSSocket);
        };

        const connectRequest = transport.request({
            host: proxyUrl.hostname,
            port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
            method: "CONNECT",
            path: `${targetUrl.hostname}:${targetPort}`,
            headers,
        });

        connectRequest.setTimeout(timeoutMs, () => {
            connectRequest.destroy(new Error(`Google geocoding proxy tunnel timed out after ${timeoutMs}ms`));
        });

        connectRequest.on("connect", (response, proxySocket) => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                proxySocket.destroy();
                finish(new Error(`Google geocoding proxy tunnel failed with status ${response.statusCode || 500}`));
                return;
            }

            const secureSocket = tls.connect({
                socket: proxySocket,
                servername: targetUrl.hostname,
            });
            if (typeof secureSocket.setTimeout === "function") {
                secureSocket.setTimeout(timeoutMs, () => {
                    secureSocket.destroy(new Error(`Google geocoding TLS handshake timed out after ${timeoutMs}ms`));
                });
            }
            secureSocket.once("secureConnect", () => {
                if (typeof secureSocket.setTimeout === "function") {
                    secureSocket.setTimeout(0);
                }
                finish(null, secureSocket);
            });
            secureSocket.once("error", (error) => finish(error));
        });

        connectRequest.once("error", (error) => finish(error));
        connectRequest.end();
    });
}

async function requestJsonWithProxy(url: URL, proxyUrl: URL, timeoutMs: number) {
    const agent = new https.Agent({ keepAlive: false });
    (
        agent as https.Agent & {
            createConnection: (
                options: unknown,
                callback?: (error: Error | null, socket: tls.TLSSocket) => void
            ) => tls.TLSSocket;
        }
    ).createConnection = (_options, callback) => {
        createProxyTlsConnection(proxyUrl, url, timeoutMs)
            .then((socket) => callback?.(null, socket))
            .catch((error) => callback?.(error as Error, undefined as unknown as tls.TLSSocket));
        return undefined as unknown as tls.TLSSocket;
    };

    try {
        return await new Promise<unknown>((resolve, reject) => {
            const request = https.request(
                url,
                {
                    agent,
                    method: "GET",
                    headers: {
                        Accept: "application/json",
                    },
                },
                (response) => {
                    readJsonResponse(response).then(resolve).catch(reject);
                }
            );

            request.setTimeout(timeoutMs, () => {
                request.destroy(new Error(`Google geocoding request timed out after ${timeoutMs}ms`));
            });
            request.once("error", reject);
            request.end();
        });
    } finally {
        agent.destroy();
    }
}

async function defaultGeocodeTransport(url: URL, context: GeocodeTransportContext) {
    try {
        if (context.proxyUrl) {
            return await requestJsonWithProxy(url, context.proxyUrl, context.timeoutMs);
        }
        return await requestJsonWithFetch(url, context.timeoutMs);
    } catch (error) {
        throw wrapGoogleMapsError(error, context.proxyUrl);
    }
}

export function hasGoogleMapsKey(env: GoogleMapsEnv = process.env) {
    return Boolean(getApiKey(env));
}

export function resolveGoogleMapsProxyUrl(env: GoogleMapsEnv = process.env) {
    const rawValue =
        env.GOOGLE_MAPS_PROXY_URL ||
        env.HTTPS_PROXY ||
        env.HTTP_PROXY ||
        env.https_proxy ||
        env.http_proxy ||
        "";
    if (!rawValue.trim()) {
        return null;
    }

    const proxyUrl = new URL(normalizeProxyUrl(rawValue));
    if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
        throw new Error(`Unsupported Google Maps proxy protocol: ${proxyUrl.protocol}`);
    }
    return proxyUrl;
}

export async function geocodeAddress(
    address: string,
    options?: {
        env?: GoogleMapsEnv;
        transport?: GeocodeTransport;
    }
): Promise<GeocodeResult | null> {
    const env = options?.env || process.env;
    const apiKey = getApiKey(env);
    if (!apiKey || !address.trim()) {
        return null;
    }

    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);

    const json = (await (options?.transport || defaultGeocodeTransport)(url, {
        proxyUrl: resolveGoogleMapsProxyUrl(env),
        timeoutMs: getTimeoutMs(env),
    })) as {
        results?: Array<{
            formatted_address?: string;
            place_id?: string;
            geometry?: {
                location?: {
                    lat?: number;
                    lng?: number;
                };
            };
        }>;
    };

    const first = Array.isArray(json.results) ? json.results[0] : null;
    if (!first?.geometry?.location) {
        return null;
    }

    return {
        formattedAddress: first.formatted_address || address,
        lat: Number(first.geometry.location.lat),
        lng: Number(first.geometry.location.lng),
        placeId: first.place_id || undefined,
        rawResponseJson: JSON.stringify(json),
    };
}
