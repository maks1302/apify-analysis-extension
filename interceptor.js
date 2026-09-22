(() => {
  "use strict";

  const MESSAGE_SOURCE = "apify-earnings-dashboard";
  const ENDPOINT_HOST = "console-backend.apify.com";
  const ENDPOINTS = new Map([
    ["/actor-analytics/profit-margin", "PROFIT_MARGIN_DATA"],
    ["/actor-analytics/actor-breakdown", "ACTOR_BREAKDOWN_DATA"],
  ]);
  const actorsByMonth = new Map();
  const profitRequestByMonth = new Map();
  const loadingMonths = new Set();
  const runLoadingMonths = new Set();
  const userLoadingMonths = new Set();
  const qualityLoadingMonths = new Set();
  const qualityRequestedMonths = new Set();
  const manualLoadingMonths = new Set();
  let latestProfitTemplate = null;

  const monthKey = (value) => String(value || "").slice(0, 7);

  const post = (message) => {
    window.postMessage({ source: MESSAGE_SOURCE, ...message }, window.location.origin);
  };

  const loadWithTimeout = async (url, init, timeoutMs = 20000) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await originalFetch(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const maybeLoadDailyRuns = async (month) => {
    const key = monthKey(month);
    const actors = actorsByMonth.get(key);
    const template = profitRequestByMonth.get(key);
    if (!key || !actors?.length || !template || runLoadingMonths.has(key)) return;

    runLoadingMonths.add(key);
    let completed = 0;
    let stopped = false;
    post({ type: "ACTOR_RUN_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });

    const loadActor = async (actor) => {
      if (stopped) return;
      const url = new URL("/actor-analytics/run-statistics/monthly/all-users", template.url);
      url.searchParams.set("actorIds", actor.id);
      url.searchParams.set("month", `${key}-01`);
      try {
        const response = await loadWithTimeout(url.href, template.init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload?.dailyStats) throw new Error("Daily run statistics missing");
        post({ type: "ACTOR_RUN_DAILY_DATA", month: key, actorId: actor.id, payload });
        completed += 1;
        post({ type: "ACTOR_RUN_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });
      } catch (error) {
        stopped = true;
        post({
          type: "ACTOR_RUN_DAILY_STATUS",
          month: key,
          status: "unsupported",
          completed,
          total: actors.length,
          message: String(error?.message || "Daily run statistics failed"),
        });
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (!stopped && cursor < actors.length) {
        const actor = actors[cursor];
        cursor += 1;
        await loadActor(actor);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, actors.length) }, worker));
    if (!stopped) {
      post({ type: "ACTOR_RUN_DAILY_STATUS", month: key, status: "complete", completed, total: actors.length });
    }
  };

  const maybeLoadDailyUsers = async (month) => {
    const key = monthKey(month);
    const actors = actorsByMonth.get(key);
    const template = profitRequestByMonth.get(key);
    if (!key || !actors?.length || !template || userLoadingMonths.has(key)) return;

    userLoadingMonths.add(key);
    let completed = 0;
    let stopped = false;
    post({ type: "ACTOR_USER_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });

    const loadActor = async (actor) => {
      if (stopped) return;
      const url = new URL("/actor-analytics/user-count-statistics", template.url);
      url.searchParams.set("actorIds", actor.id);
      url.searchParams.set("month", `${key}-01`);
      try {
        const response = await loadWithTimeout(url.href, template.init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || typeof payload !== "object") throw new Error("Daily user statistics missing");
        post({ type: "ACTOR_USER_DAILY_DATA", month: key, actorId: actor.id, payload });
        completed += 1;
        post({ type: "ACTOR_USER_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });
      } catch (error) {
        stopped = true;
        post({ type: "ACTOR_USER_DAILY_STATUS", month: key, status: "unsupported", completed, total: actors.length, message: String(error?.message || "Daily user statistics failed") });
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (!stopped && cursor < actors.length) {
        const actor = actors[cursor];
        cursor += 1;
        await loadActor(actor);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, actors.length) }, worker));
    if (!stopped) post({ type: "ACTOR_USER_DAILY_STATUS", month: key, status: "complete", completed, total: actors.length });
  };

  const maybeLoadDailyActors = async (month) => {
    const key = monthKey(month);
    const actors = actorsByMonth.get(key)?.filter((actor) => actor.hasRevenue);
    const template = profitRequestByMonth.get(key);
    if (!key || !actors?.length || !template || loadingMonths.has(key)) return;

    loadingMonths.add(key);
    let completed = 0;
    let stopped = false;
    post({ type: "ACTOR_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });

    const loadActor = async (actor) => {
      if (stopped) return;
      const url = new URL(template.url);
      url.searchParams.set("actorIds", actor.id);
      try {
        const response = await loadWithTimeout(url.href, template.init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload?.dailyProfitMarginStats) throw new Error("Daily data missing");
        post({ type: "ACTOR_DAILY_DATA", month: key, actorId: actor.id, payload });
        completed += 1;
        post({ type: "ACTOR_DAILY_STATUS", month: key, status: "loading", completed, total: actors.length });
      } catch (error) {
        stopped = true;
        post({
          type: "ACTOR_DAILY_STATUS",
          month: key,
          status: "unsupported",
          completed,
          total: actors.length,
          message: String(error?.message || "Actor filtering failed"),
        });
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (!stopped && cursor < actors.length) {
        const actor = actors[cursor];
        cursor += 1;
        await loadActor(actor);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, actors.length) }, worker));

    if (!stopped) {
      post({ type: "ACTOR_DAILY_STATUS", month: key, status: "complete", completed, total: actors.length });
    }
  };

  const loadActorQuality = async (month) => {
    const key = monthKey(month);
    const actors = actorsByMonth.get(key);
    const template = profitRequestByMonth.get(key) || latestProfitTemplate;
    if (!key || qualityLoadingMonths.has(key)) return;
    if (!actors?.length || !template) {
      post({
        type: "ACTOR_QUALITY_STATUS",
        month: key,
        status: "waiting-request",
        completed: 0,
        total: actors?.length || 0,
        message: !actors?.length
          ? "Waiting for the Actor breakdown for this month."
          : "Waiting for an authenticated Apify analytics request.",
      });
      return;
    }

    qualityLoadingMonths.add(key);
    let completed = 0;
    post({ type: "ACTOR_QUALITY_STATUS", month: key, status: "loading", completed, total: actors.length });

    const getJson = async (pathname) => {
      const url = new URL(pathname, template.url);
      const response = await loadWithTimeout(url.href, template.init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };

    const loadActor = async (actor) => {
      const actorId = encodeURIComponent(actor.id);
      const requests = await Promise.allSettled([
        getJson(`/actor-quality/praises-and-improvements/${actorId}`),
        getJson(`/actor/${actorId}/basic-info`),
        getJson(`/actor-quality/scores/${actorId}`),
        getJson(`/actor/${actorId}/metrics`),
      ]);
      const value = (index) => requests[index].status === "fulfilled" ? requests[index].value : null;
      const errors = requests
        .filter((request) => request.status === "rejected")
        .map((request) => String(request.reason?.message || "Request failed"));
      post({
        type: "ACTOR_QUALITY_DATA",
        month: key,
        actorId: actor.id,
        payload: {
          feedback: value(0),
          basicInfo: value(1),
          scores: value(2),
          metrics: value(3),
          errors,
        },
      });
      completed += 1;
      post({ type: "ACTOR_QUALITY_STATUS", month: key, status: "loading", completed, total: actors.length });
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < actors.length) {
        const actor = actors[cursor];
        cursor += 1;
        await loadActor(actor);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, actors.length) }, worker));
    post({ type: "ACTOR_QUALITY_STATUS", month: key, status: "complete", completed, total: actors.length });
    qualityLoadingMonths.delete(key);
  };

  const storeProfitTemplate = (url, init) => {
    const key = monthKey(url.searchParams.get("month"));
    if (!key) return;
    const template = { url: url.href, init };
    profitRequestByMonth.set(key, template);
    latestProfitTemplate = template;
    void maybeLoadDailyActors(key);
    void maybeLoadDailyRuns(key);
    void maybeLoadDailyUsers(key);
    if (qualityRequestedMonths.has(key)) void loadActorQuality(key);
  };

  const rememberProfitRequest = (request, init, url) => {
    if (url.searchParams.get("actorIds")) return;
    try {
      const normalized = new Request(request, init);
      storeProfitTemplate(url, {
        method: "GET",
        headers: new Headers(normalized.headers),
        credentials: normalized.credentials,
        cache: normalized.cache,
        redirect: normalized.redirect,
      });
    } catch {
      // The regular passive dashboard continues to work if a request cannot be cloned.
    }
  };

  const publish = (url, payload) => {
    let type = ENDPOINTS.get(url.pathname);
    if (!type) return;

    const actorIds = url.searchParams.get("actorIds");
    if (url.pathname === "/actor-analytics/profit-margin" && actorIds) {
      post({ type: "ACTOR_DAILY_DATA", month: monthKey(url.searchParams.get("month")), actorId: actorIds, payload });
      return;
    }

    if (url.pathname === "/actor-analytics/actor-breakdown") {
      const key = monthKey(url.searchParams.get("month"));
      const actors = Array.isArray(payload?.monetizationPerActor)
        ? payload.monetizationPerActor
          .filter((item) => item?.actor?._id)
          .map((item) => ({
            id: String(item.actor._id),
            hasRevenue: Number(item?.earningsStats?.totalRevenueUsd) > 0,
          }))
        : [];
      actorsByMonth.set(key, actors);
      if (!profitRequestByMonth.has(key)) {
        post({
          type: "ACTOR_DAILY_STATUS",
          month: key,
          status: "waiting-request",
          completed: 0,
          total: actors.length,
          message: "Waiting for Apify to request profit-margin for this month.",
        });
        post({
          type: "ACTOR_RUN_DAILY_STATUS",
          month: key,
          status: "waiting-request",
          completed: 0,
          total: actors.length,
          message: "Waiting for an authenticated analytics request for this month.",
        });
        post({
          type: "ACTOR_USER_DAILY_STATUS",
          month: key,
          status: "waiting-request",
          completed: 0,
          total: actors.length,
          message: "Waiting for an authenticated analytics request for this month.",
        });
      }
      void maybeLoadDailyActors(key);
      void maybeLoadDailyRuns(key);
      void maybeLoadDailyUsers(key);
      if (qualityRequestedMonths.has(key)) void loadActorQuality(key);
    }

    post({ type, month: url.searchParams.get("month"), payload });
  };

  const inspectResponse = async (requestUrl, response) => {
    try {
      const url = new URL(requestUrl, window.location.href);
      if (url.hostname !== ENDPOINT_HOST || !ENDPOINTS.has(url.pathname)) return;

      const payload = await response.clone().json();
      publish(url, payload);
    } catch {
      // Analytics must never interfere with Apify Console's request.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const requestUrl = typeof request === "string" || request instanceof URL
      ? request.toString()
      : request?.url;

    if (requestUrl) {
      try {
        const url = new URL(requestUrl, window.location.href);
        if (url.hostname === ENDPOINT_HOST && url.pathname === "/actor-analytics/profit-margin") {
          rememberProfitRequest(request, args[1], url);
        }
      } catch {
        // Ignore malformed URLs and let the original request proceed.
      }
    }

    const response = await originalFetch.apply(this, args);

    if (requestUrl) void inspectResponse(requestUrl, response);
    return response;
  };

  const xhrMetadata = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const metadata = xhrMetadata.get(this);
    if (metadata) metadata.headers.append(name, value);
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const metadata = { method, url, headers: new Headers() };
    xhrMetadata.set(this, metadata);
    this.addEventListener("load", () => {
      try {
        const parsedUrl = new URL(url, window.location.href);
        if (parsedUrl.hostname !== ENDPOINT_HOST || !ENDPOINTS.has(parsedUrl.pathname)) return;

        if (parsedUrl.pathname === "/actor-analytics/profit-margin" && !parsedUrl.searchParams.get("actorIds")) {
          storeProfitTemplate(parsedUrl, {
            method: "GET",
            headers: new Headers(metadata.headers),
            credentials: this.withCredentials ? "include" : "same-origin",
          });
        }

        const payload = this.responseType === "json"
          ? this.response
          : JSON.parse(this.responseText);

        publish(parsedUrl, payload);
      } catch {
        // Ignore non-JSON and inaccessible responses.
      }
    }, { once: true });

    return originalOpen.call(this, method, url, ...rest);
  };

  const requestMonth = async (month) => {
    const key = monthKey(month);
    if (!/^\d{4}-\d{2}$/.test(key) || manualLoadingMonths.has(key)) return;
    if (!latestProfitTemplate) {
      post({ type: "MONTH_LOAD_STATUS", month: key, status: "error", message: "Reload Apify Monetization first so an authenticated request can be captured." });
      return;
    }

    manualLoadingMonths.add(key);
    post({ type: "MONTH_LOAD_STATUS", month: key, status: "loading" });
    try {
      const profitUrl = new URL("/actor-analytics/profit-margin", latestProfitTemplate.url);
      profitUrl.searchParams.set("month", `${key}-01`);
      profitUrl.searchParams.delete("actorIds");
      const breakdownUrl = new URL("/actor-analytics/actor-breakdown", latestProfitTemplate.url);
      breakdownUrl.searchParams.set("month", `${key}-01`);
      breakdownUrl.searchParams.set("actorIds", "");

      storeProfitTemplate(profitUrl, latestProfitTemplate.init);
      const [profitResponse, breakdownResponse] = await Promise.all([
        loadWithTimeout(profitUrl.href, latestProfitTemplate.init),
        loadWithTimeout(breakdownUrl.href, latestProfitTemplate.init),
      ]);
      if (!profitResponse.ok || !breakdownResponse.ok) {
        throw new Error(`HTTP ${!profitResponse.ok ? profitResponse.status : breakdownResponse.status}`);
      }
      const [profitPayload, breakdownPayload] = await Promise.all([profitResponse.json(), breakdownResponse.json()]);
      publish(profitUrl, profitPayload);
      publish(breakdownUrl, breakdownPayload);
      post({ type: "MONTH_LOAD_STATUS", month: key, status: "complete" });
    } catch (error) {
      post({ type: "MONTH_LOAD_STATUS", month: key, status: "error", message: String(error?.message || "Month loading failed") });
    } finally {
      manualLoadingMonths.delete(key);
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data?.type === "REQUEST_MONTH") void requestMonth(event.data.month);
    if (event.data?.type === "REQUEST_ACTOR_QUALITY") {
      const key = monthKey(event.data.month);
      if (key) qualityRequestedMonths.add(key);
      void loadActorQuality(key);
    }
  });
})();
