/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
const path = require("node:path");

async function withModuleMocks(mocks, run) {
  const originalLoad = Module._load;
  const originalResolveFilename = Module._resolveFilename;

  try {
    Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    Module._load = function mockLoad(request, parent, isMain) {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    return await run();
  } finally {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
  }
}

class FakeRequest extends EventEmitter {
  end() {
    return undefined;
  }

  destroy(error) {
    if (error) {
      this.emit("error", error);
    }
  }

  setTimeout() {
    return this;
  }
}

class FakeResponse extends EventEmitter {
  constructor(statusCode, body) {
    super();
    this.statusCode = statusCode;
    this.body = body;
  }

  setEncoding() {
    return undefined;
  }

  flush() {
    this.emit("data", this.body);
    this.emit("end");
  }
}

(async () => {
  const originalFetch = global.fetch;
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;

  try {
    let fetchedUrl = null;
    process.env.GOOGLE_MAPS_API_KEY = "plain-key";
    global.fetch = async (url) => {
      fetchedUrl = String(url);
      return {
        ok: true,
        async json() {
          return {
            results: [
              {
                formatted_address: "Toronto, ON, Canada",
                geometry: { location: { lat: 43.6532, lng: -79.3832 } },
                place_id: "plain-fetch-place",
              },
            ],
          };
        },
      };
    };

    delete require.cache[require.resolve("../src/lib/google-maps.ts")];
    let googleMaps = require("../src/lib/google-maps.ts");
    let result = await googleMaps.geocodeAddress("Toronto");
    assert.ok(fetchedUrl?.includes("address=Toronto"));
    assert.equal(result.placeId, "plain-fetch-place");

    const connectCalls = [];
    const httpsRequests = [];

    process.env.GOOGLE_MAPS_API_KEY = "proxy-key";
    process.env.GOOGLE_MAPS_PROXY_URL = "127.0.0.1:7890";

    await withModuleMocks(
      {
        "node:http": {
          request(options) {
            connectCalls.push(options);
            const request = new FakeRequest();
            request.end = () => {
              const proxySocket = {
                destroyed: false,
                destroy() {
                  this.destroyed = true;
                },
              };
              process.nextTick(() => {
                request.emit("connect", { statusCode: 200 }, proxySocket);
              });
            };
            return request;
          },
        },
        "node:tls": {
          connect(options) {
            const secureSocket = new EventEmitter();
            secureSocket.servername = options.servername;
            secureSocket.destroyed = false;
            secureSocket.destroy = () => {
              secureSocket.destroyed = true;
            };
            process.nextTick(() => {
              secureSocket.emit("secureConnect");
            });
            return secureSocket;
          },
        },
        "node:https": {
          Agent: class MockAgent {
            constructor(options) {
              this.options = options;
            }

            createConnection(options, callback) {
              return this.options.createConnection(options, callback);
            }

            destroy() {
              return undefined;
            }
          },
          request(url, options, callback) {
            httpsRequests.push({ url: String(url), options });
            const request = new FakeRequest();
            process.nextTick(() => {
              options.agent.createConnection(
                { host: "maps.googleapis.com", port: 443, servername: "maps.googleapis.com" },
                (error) => {
                  if (error) {
                    request.emit("error", error);
                    return;
                  }
                  const response = new FakeResponse(
                    200,
                    JSON.stringify({
                      results: [
                        {
                          formatted_address: "Simcoe Hall, 27 King's College Cir, Toronto, ON M5S, Canada",
                          geometry: { location: { lat: 43.6608512, lng: -79.3957833 } },
                          place_id: "ChIJQz__lbg0K4gRNjbNOy3EIDQ",
                        },
                      ],
                    })
                  );
                  callback(response);
                  process.nextTick(() => response.flush());
                }
              );
            });
            return request;
          },
        },
      },
      async () => {
        global.fetch = async () => {
          throw new Error("plain fetch should not be used when proxy is configured");
        };
        delete require.cache[require.resolve("../src/lib/google-maps.ts")];
        googleMaps = require("../src/lib/google-maps.ts");
        result = await googleMaps.geocodeAddress("27 King's College Cir, Toronto, ON M5S 1A1, 加拿大");
      }
    );

    assert.equal(connectCalls.length, 1);
    assert.equal(connectCalls[0].host, "127.0.0.1");
    assert.equal(connectCalls[0].port, 7890);
    assert.equal(connectCalls[0].method, "CONNECT");
    assert.equal(connectCalls[0].path, "maps.googleapis.com:443");
    assert.equal(httpsRequests.length, 1);
    assert.ok(httpsRequests[0].url.includes("maps.googleapis.com/maps/api/geocode/json"));
    assert.ok(httpsRequests[0].url.includes("proxy-key"));
    assert.ok(httpsRequests[0].url.includes("King%27s+College+Cir"));
    assert.equal(result.formattedAddress, "Simcoe Hall, 27 King's College Cir, Toronto, ON M5S, Canada");
    assert.equal(result.placeId, "ChIJQz__lbg0K4gRNjbNOy3EIDQ");
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_PROXY_URL;
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  }

  console.log("google-maps.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
