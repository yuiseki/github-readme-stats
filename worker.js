// @ts-check
// Cloudflare Workers entrypoint. Adapts the existing Vercel-style (req, res)
// handlers in api/*.js to the Workers fetch(Request) -> Response signature
// without modifying their business logic. Env vars/secrets are supplied via
// Workers bindings (see fetch() below), not dotenv/.env files.
import axios from "axios";

// axios' default Node adapter doesn't behave reliably under the Workers
// nodejs_compat HTTP shim (malformed response bodies). axios ships a fetch()
// based adapter that works correctly here; only set as the default here in
// the Workers entrypoint so the Node/Vercel-style handlers stay untouched and
// test mocking (axios-mock-adapter overrides defaults.adapter itself) is
// unaffected.
axios.defaults.adapter = "fetch";
// axios' Node adapter auto-sends a User-Agent; the fetch adapter does not,
// and the GitHub API rejects requests without one (403 "forbidden by
// administrative rules").
axios.defaults.headers.common["User-Agent"] = "github-readme-stats";

import statsCard from "./api/index.js";
import repoCard from "./api/pin.js";
import langCard from "./api/top-langs.js";
import wakatimeCard from "./api/wakatime.js";
import gistCard from "./api/gist.js";
import statusUp from "./api/status/up.js";
import statusPatInfo from "./api/status/pat-info.js";

const routes = {
  "/api": statsCard,
  "/api/": statsCard,
  "/api/pin": repoCard,
  "/api/top-langs": langCard,
  "/api/wakatime": wakatimeCard,
  "/api/gist": gistCard,
  "/api/status/up": statusUp,
  "/api/status/pat-info": statusPatInfo,
};

function buildNodeReq(request, url) {
  const query = Object.fromEntries(url.searchParams.entries());
  return { query, headers: Object.fromEntries(request.headers) };
}

function buildNodeRes() {
  const headers = new Headers();
  let statusCode = 200;
  /** @type {(r: Response) => void} */
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  let settled = false;

  const serialize = (body) => {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") return body;
    if (typeof body === "object") {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return JSON.stringify(body);
    }
    return String(body);
  };

  const finish = (body) => {
    if (settled) return;
    settled = true;
    resolve(new Response(serialize(body), { status: statusCode, headers }));
  };

  const res = {
    setHeader(key, value) {
      headers.set(key, value);
      return res;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    send(body) {
      finish(body);
      return res;
    },
    end(body) {
      finish(body);
      return res;
    },
    json(body) {
      headers.set("Content-Type", "application/json");
      finish(body);
      return res;
    },
  };

  return { res, promise };
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   */
  async fetch(request, env) {
    // The handlers read config via process.env (Vercel convention).
    // nodejs_compat provides a `process` global; populate it per-request
    // from the Worker's bound environment variables/secrets.
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") process.env[key] = value;
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(
        "https://github.com/anuraghazra/github-readme-stats",
        302,
      );
    }

    const handler = routes[url.pathname];
    if (!handler) {
      return new Response("Not found", { status: 404 });
    }

    const nodeReq = buildNodeReq(request, url);
    const { res, promise } = buildNodeRes();

    try {
      await handler(nodeReq, res);
    } catch (err) {
      if (!promise.resolved) {
        return new Response("Internal error: " + err.message, {
          status: 500,
        });
      }
    }

    return promise;
  },
};
