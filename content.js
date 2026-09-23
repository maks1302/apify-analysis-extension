(() => {
  "use strict";

  const MESSAGE_SOURCE = "apify-earnings-dashboard";
  const STORAGE_KEY = "apifyEarningsMonths";
  const QUALITY_STORAGE_KEY = "apifyActorQuality";
  const UI_ID = "apify-earnings-extension-root";
  let months = {};
  let actorQuality = {};
  let selectedMonth = null;
  let panelOpen = false;
  let panelFullscreen = false;
  let activeView = "overview";
  let dailyMetric = "revenueUsd";
  let healthMetric = "problemRuns";
  let runMetric = "FAILED";
  let userMetric = "payingUsers";
  let selectedActorIds = null;
  let actorPickerOpen = false;
  const expandedQualityActorIds = new Set();
  const expandedMarketingActorIds = new Set();
  let pendingMonth = null;
  let comparisonMonthRequest = null;
  const dailyLoadStatus = {};
  const runLoadStatus = {};
  const userLoadStatus = {};
  const qualityLoadStatus = {};
  const marketingLoadStatus = {};
  const monthLoadStatus = {};

  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number(value));
  const compactMoney = (value) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number(value));
  const percent = (value) => `${(number(value) * 100).toFixed(1)}%`;
  const integer = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number(value));
  const compactInteger = (value) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(number(value));

  const actorSelected = (actorId) => selectedActorIds === null || selectedActorIds.has(actorId);
  const selectedActors = (data) => (data?.actorBreakdown?.actors || []).filter((actor) => actorSelected(actor.id));

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function offsetMonth(month, offset) {
    const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function dateIsVisibleForMonth(date, month) {
    const selected = String(month || "").slice(0, 7);
    if (!selected) return true;
    if (!date.startsWith(`${selected}-`)) return false;
    const today = localDateKey();
    const currentMonth = today.slice(0, 7);
    if (selected < currentMonth) return true;
    if (selected > currentMonth) return false;
    return date <= today;
  }

  function unwrapStats(value) {
    if (!value || typeof value !== "object") return {};
    return value.payingUsersUsd && typeof value.payingUsersUsd === "object"
      ? value.payingUsersUsd
      : value;
  }

  function sanitizeStats(value) {
    const stats = unwrapStats(value);
    const revenueUsd = number(stats.revenueUsd);
    const profitUsd = number(stats.profitUsd);
    return {
      revenueUsd,
      profitUsd,
      margin: Number.isFinite(Number(stats.margin))
        ? Number(stats.margin)
        : revenueUsd ? profitUsd / revenueUsd : 0,
      costUsd: Number.isFinite(Number(stats.costUsd))
        ? Number(stats.costUsd)
        : revenueUsd - profitUsd,
    };
  }

  function normalizePayload(payload, requestedMonth) {
    if (!payload || typeof payload !== "object") return null;
    const source = payload.dailyProfitMarginStats;
    if (!source || typeof source !== "object") return null;

    const daily = Object.entries(source)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, value]) => ({ date, ...sanitizeStats(value) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!daily.length) return null;

    const fallbackTotal = daily.reduce((total, day) => ({
      revenueUsd: total.revenueUsd + day.revenueUsd,
      profitUsd: total.profitUsd + day.profitUsd,
      costUsd: total.costUsd + day.costUsd,
    }), { revenueUsd: 0, profitUsd: 0, costUsd: 0 });

    const hasTotal = payload.totalProfitMarginStats && typeof payload.totalProfitMarginStats === "object";
    const total = hasTotal ? sanitizeStats(payload.totalProfitMarginStats) : {
      ...fallbackTotal,
      margin: fallbackTotal.revenueUsd ? fallbackTotal.profitUsd / fallbackTotal.revenueUsd : 0,
    };

    const inferredMonth = daily[0].date.slice(0, 7);
    return {
      month: (requestedMonth || inferredMonth).slice(0, 7),
      capturedAt: new Date().toISOString(),
      daily,
      total,
    };
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function plainText(value) {
    if (!value) return "";
    const element = document.createElement("div");
    element.innerHTML = String(value);
    return String(element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function firstHttpsLink(value) {
    if (!value) return "";
    const element = document.createElement("div");
    element.innerHTML = String(value);
    const href = element.querySelector("a[href]")?.getAttribute("href");
    return safeImageUrl(href);
  }

  function normalizeActorQuality(payload, actorId) {
    if (!payload || typeof payload !== "object") return null;
    const basic = payload.basicInfo || {};
    const stats = basic.stats || {};
    const scores = payload.scores || {};
    const metrics = payload.metrics || {};
    const feedback = payload.feedback || {};
    const runStats = metrics.publicActorRunStats30Days || stats.publicActorRunStats30Days || {};
    const pricing = Array.isArray(basic.pricingInfos) ? basic.pricingInfos.at(-1) || {} : {};
    const firstNumber = (...values) => {
      const value = values.find((item) => item !== null && item !== undefined && item !== "" && Number.isFinite(Number(item)));
      return number(value);
    };

    return {
      id: String(basic._id || actorId || ""),
      name: String(basic.name || ""),
      title: String(basic.title || basic.name || "Unknown actor"),
      username: String(basic.username || ""),
      pictureUrl: safeImageUrl(basic.pictureUrl),
      description: plainText(basic.description),
      categories: Array.isArray(basic.categories) ? basic.categories.map(String) : [],
      isPublic: Boolean(basic.isPublic),
      isDeprecated: Boolean(basic.isDeprecated),
      notice: String(basic.notice || "NONE"),
      memoryMbytes: number(basic.defaultRunOptions?.memoryMbytes),
      timeoutSecs: number(basic.defaultRunOptions?.timeoutSecs),
      pricingModel: String(pricing.pricingModel || "Unknown"),
      hasQualityScore: scores.actorQuality !== null && scores.actorQuality !== undefined && Number.isFinite(Number(scores.actorQuality)),
      quality: number(scores.actorQuality),
      qualityPercentile: number(scores.actorQualityPercentile),
      hasInputSchema: Boolean(scores.hasInputSchema),
      hasOutputSchema: Boolean(scores.hasOutputSchema),
      hasReadme: Boolean(scores.hasReadme),
      bookmarks: firstNumber(metrics.bookmarkCount, stats.bookmarkCount),
      reviewCount: firstNumber(metrics.actorReviewCount, stats.actorReviewCount),
      reviewRating: firstNumber(metrics.actorReviewRating, stats.actorReviewRating),
      totalBuilds: firstNumber(metrics.totalBuilds, stats.totalBuilds),
      totalRuns: firstNumber(metrics.totalRuns, stats.totalRuns),
      totalUsers: firstNumber(metrics.totalUsers, stats.totalUsers),
      users7Days: firstNumber(metrics.totalUsers7Days, stats.totalUsers7Days),
      users30Days: firstNumber(metrics.totalUsers30Days, stats.totalUsers30Days),
      users90Days: firstNumber(metrics.totalUsers90Days, stats.totalUsers90Days),
      lastRunStartedAt: String(metrics.lastRunStartedAt || stats.lastRunStartedAt || ""),
      createdAt: String(basic.createdAt || metrics.createdAt || ""),
      firstPublishedAt: String(basic.firstPublishedAt || ""),
      issueResponseTimeDays: metrics.issueResponseTimeDays == null ? null : number(metrics.issueResponseTimeDays),
      runSuccessRate: Number.isFinite(Number(metrics.runSuccessRate))
        ? Number(metrics.runSuccessRate)
        : number(runStats.TOTAL) ? number(runStats.SUCCEEDED) / number(runStats.TOTAL) : 0,
      runs30Days: {
        total: number(runStats.TOTAL),
        succeeded: number(runStats.SUCCEEDED),
        failed: number(runStats.FAILED),
        aborted: number(runStats.ABORTED),
        timedOut: number(runStats["TIMED-OUT"]),
      },
      praises: Array.isArray(feedback.praises) ? feedback.praises.map((item) => ({
        title: plainText(item?.title),
        description: plainText(item?.description),
        percentile: number(item?.percentile),
      })) : [],
      improvements: Array.isArray(feedback.improvements) ? feedback.improvements.map((item) => ({
        id: String(item?.id || ""),
        title: plainText(item?.title),
        description: plainText(item?.description),
        link: firstHttpsLink(item?.description),
      })) : [],
      errors: Array.isArray(payload.errors) ? payload.errors.map(String) : [],
      capturedAt: new Date().toISOString(),
    };
  }

  async function saveActorQuality(quality) {
    if (!quality?.id) return;
    actorQuality[quality.id] = quality;
    await chrome.storage.local.set({ [QUALITY_STORAGE_KEY]: actorQuality });
    render();
  }

  function normalizeActorBreakdown(payload, requestedMonth) {
    if (!payload || !Array.isArray(payload.monetizationPerActor)) return null;
    const actors = payload.monetizationPerActor.map((item) => {
      const actor = item?.actor || {};
      const runs = item?.runsStats || {};
      const earnings = item?.earningsStats || {};
      const users = item?.usersStats || {};
      const pricing = item?.currentPricingInfo || {};
      const totalRuns = number(runs.TOTAL);
      const successfulRuns = number(runs.SUCCEEDED);

      return {
        id: String(actor._id || ""),
        name: String(actor.name || "Unknown actor"),
        title: String(actor.title || actor.name || "Unknown actor"),
        username: String(actor.username || ""),
        pictureUrl: safeImageUrl(actor.pictureUrl),
        revenueUsd: number(earnings.totalRevenueUsd),
        costUsd: number(earnings.totalCostUsd),
        profitUsd: number(earnings.totalProfitUsd),
        freeUsers: number(users.freeUsers),
        payingUsers: number(users.payingUsers),
        totalRuns,
        successfulRuns,
        failedRuns: number(runs.FAILED),
        abortedRuns: number(runs.ABORTED),
        timedOutRuns: number(runs["TIMED-OUT"]),
        results: number(runs.RESULTS),
        chargedResults: number(item?.chargedResults),
        successRate: totalRuns ? successfulRuns / totalRuns : 0,
        margin: number(earnings.totalRevenueUsd)
          ? number(earnings.totalProfitUsd) / number(earnings.totalRevenueUsd)
          : 0,
        pricingModel: String(pricing.pricingModel || "Unknown"),
      };
    }).sort((a, b) => b.profitUsd - a.profitUsd);

    const inferredMonth = requestedMonth || new Date().toISOString().slice(0, 7);
    return {
      month: inferredMonth.slice(0, 7),
      capturedAt: new Date().toISOString(),
      currentMonthProfitUsd: number(payload.currentMonthProfitUsd),
      previousMonthProfitUsd: number(payload.previousMonthProfitUsd),
      actors,
    };
  }

  async function saveProfitMonth(monthData, { background = false } = {}) {
    months[monthData.month] = { ...months[monthData.month], ...monthData };
    if (!background && comparisonMonthRequest?.target !== monthData.month) selectedMonth = monthData.month;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  async function saveActorBreakdown(breakdown, { background = false } = {}) {
    months[breakdown.month] = {
      ...months[breakdown.month],
      month: breakdown.month,
      actorBreakdown: breakdown,
    };
    if (!background && comparisonMonthRequest?.target !== breakdown.month) selectedMonth = breakdown.month;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    if (activeView === "quality") {
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_QUALITY", month: breakdown.month }, window.location.origin);
    }
    if (activeView === "acquisition") {
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_MARKETING", month: breakdown.month }, window.location.origin);
    }
    render();
  }

  function normalizeActorDaily(payload) {
    const source = payload?.dailyProfitMarginStats;
    if (!source || typeof source !== "object") return null;
    const daily = Object.entries(source)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, value]) => ({ date, ...sanitizeStats(value) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return daily.length ? daily : null;
  }

  async function saveActorDaily(month, actorId, daily) {
    const key = String(month || "").slice(0, 7);
    if (!key || !actorId || !daily) return;
    months[key] = {
      ...months[key],
      month: key,
      actorDaily: { ...(months[key]?.actorDaily || {}), [actorId]: daily },
    };
    selectedMonth = key;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  function normalizeActorRunDaily(payload) {
    const source = payload?.dailyStats;
    if (!source || typeof source !== "object") return null;
    const daily = Object.entries(source)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, stats]) => ({
        date,
        ABORTED: number(stats?.ABORTED),
        FAILED: number(stats?.FAILED),
        SUCCEEDED: number(stats?.SUCCEEDED),
        "TIMED-OUT": number(stats?.["TIMED-OUT"]),
        TOTAL: number(stats?.TOTAL),
        RESULTS: number(stats?.RESULTS),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return daily.length ? daily : null;
  }

  async function saveActorRunDaily(month, actorId, daily) {
    const key = String(month || "").slice(0, 7);
    if (!key || !actorId || !daily) return;
    months[key] = {
      ...months[key],
      month: key,
      actorRunDaily: { ...(months[key]?.actorRunDaily || {}), [actorId]: daily },
    };
    selectedMonth = key;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  function normalizeActorUserDaily(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const daily = Object.entries(payload)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, stats]) => ({
        date,
        freeUsers: number(stats?.freeUsers),
        payingUsers: number(stats?.payingUsers),
        totalUsers: number(stats?.freeUsers) + number(stats?.payingUsers),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return daily.length ? daily : null;
  }

  async function saveActorUserDaily(month, actorId, daily) {
    const key = String(month || "").slice(0, 7);
    if (!key || !actorId || !daily) return;
    months[key] = {
      ...months[key],
      month: key,
      actorUserDaily: { ...(months[key]?.actorUserDaily || {}), [actorId]: daily },
    };
    selectedMonth = key;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  function normalizeActorMarketing(payload, actorId, error) {
    const available = Boolean(payload && typeof payload === "object");
    const normalizeTraffic = (items, directLabel = "Direct / unknown") => Array.isArray(items)
      ? items.map((item) => ({
        origin: String(item?.origin || directLabel),
        trafficPercent: Math.max(0, number(item?.trafficPercent)),
      })).filter((item) => item.trafficPercent > 0)
      : [];
    return {
      id: String(actorId || ""),
      available,
      monthStartAt: String(payload?.monthStartAt || ""),
      webPageViews: number(payload?.numUniqueWebPageViews),
      consolePageViews: number(payload?.numUniqueConsolePageViews),
      usersWithRun: number(payload?.numUniqueUsersWithRun),
      viewingUsers: number(payload?.numUniqueViewingUsers),
      topReferrers: normalizeTraffic(payload?.topReferrers),
      topCountries: normalizeTraffic(payload?.topCountryCodes, "Unknown"),
      error: String(error || ""),
      capturedAt: new Date().toISOString(),
    };
  }

  async function saveActorMarketing(month, actorId, marketing) {
    const key = String(month || "").slice(0, 7);
    if (!key || !actorId || !marketing) return;
    months[key] = {
      ...months[key],
      month: key,
      actorMarketing: { ...(months[key]?.actorMarketing || {}), [actorId]: marketing },
    };
    selectedMonth = key;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  function overviewForSelection(data) {
    if (selectedActorIds === null) return data;
    const selectedSeries = Object.entries(data?.actorDaily || {}).filter(([id]) => selectedActorIds.has(id));
    const byDate = new Map();
    for (const [, daily] of selectedSeries) {
      for (const day of daily) {
        const current = byDate.get(day.date) || { date: day.date, revenueUsd: 0, profitUsd: 0, costUsd: 0 };
        current.revenueUsd += number(day.revenueUsd);
        current.profitUsd += number(day.profitUsd);
        current.costUsd += number(day.costUsd);
        byDate.set(day.date, current);
      }
    }
    const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
      ...day,
      margin: day.revenueUsd ? day.profitUsd / day.revenueUsd : 0,
    }));
    const total = daily.reduce((sum, day) => ({
      revenueUsd: sum.revenueUsd + day.revenueUsd,
      profitUsd: sum.profitUsd + day.profitUsd,
      costUsd: sum.costUsd + day.costUsd,
      margin: 0,
    }), { revenueUsd: 0, profitUsd: 0, costUsd: 0, margin: 0 });
    total.margin = total.revenueUsd ? total.profitUsd / total.revenueUsd : 0;
    return { ...data, daily, total };
  }

  function change(from, to) {
    if (!from) return null;
    return (to - from) / Math.abs(from);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function linePath(values, width, height, minValue, maxValue) {
    if (!values.length) return "";
    const range = maxValue - minValue || 1;
    return values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - minValue) / range) * height;
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  const actorColors = [
    "#2068F8", "#20A048", "#F86000", "#5B8FF9", "#D94C5C", "#D6A11D",
    "#7856D8", "#1EA7A1", "#D95C9D", "#4D7AD9", "#70A83A", "#A55BC4",
  ];

  function stackedActorChart(data) {
    const actorDaily = data?.actorDaily || {};
    const actorInfo = new Map((data?.actorBreakdown?.actors || []).map((actor) => [actor.id, actor]));
    const series = Object.entries(actorDaily).filter(([id]) => actorSelected(id)).map(([id, daily]) => ({
      id,
      name: actorInfo.get(id)?.title || actorInfo.get(id)?.name || id,
      daily,
      total: daily.reduce((sum, day) => sum + number(day[dailyMetric]), 0),
    })).sort((a, b) => b.total - a.total);
    if (!series.length) return null;

    const dates = [...new Set(series.flatMap((item) => item.daily.map((day) => day.date)))].sort();
    const visible = series.slice(0, 11);
    const remaining = series.slice(11);
    const chartSeries = remaining.length
      ? [...visible, { id: "other", name: `Other (${remaining.length})`, daily: [], total: remaining.reduce((sum, item) => sum + item.total, 0), grouped: remaining }]
      : visible;
    const values = new Map(series.map((item) => [item.id, new Map(item.daily.map((day) => [day.date, number(day[dailyMetric])]))]));
    const valueFor = (item, date) => item.grouped
      ? item.grouped.reduce((sum, child) => sum + number(values.get(child.id)?.get(date)), 0)
      : number(values.get(item.id)?.get(date));
    const totalsByDate = dates.map((date) => chartSeries.reduce((sum, item) => sum + valueFor(item, date), 0));
    const maxValue = Math.max(...totalsByDate, 1);
    const width = 760;
    const height = 260;
    const plotTop = 10;
    const plotHeight = 210;
    const slot = width / Math.max(dates.length, 1);
    const barWidth = Math.max(5, Math.min(30, slot * 0.68));

    const guides = [0, .25, .5, .75, 1].map((ratio) => {
      const y = plotTop + plotHeight - plotHeight * ratio;
      return `<g><line x1="0" y1="${y}" x2="${width}" y2="${y}" class="ae-guide"/><text x="0" y="${y - 4}" class="ae-stack-tick">${escapeHtml(compactMoney(maxValue * ratio))}</text></g>`;
    }).join("");

    const bars = dates.map((date, dateIndex) => {
      const x = dateIndex * slot + (slot - barWidth) / 2;
      let yBottom = plotTop + plotHeight;
      const tooltipItems = series.map((item, seriesIndex) => ({
        name: item.name,
        value: number(values.get(item.id)?.get(date)),
        color: seriesIndex < 11 ? actorColors[seriesIndex % actorColors.length] : "#5c5c6d",
      })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
      const dayTotal = tooltipItems.reduce((sum, item) => sum + item.value, 0);
      const segments = chartSeries.map((item, seriesIndex) => {
        const value = valueFor(item, date);
        if (value <= 0) return "";
        const segmentHeight = (value / maxValue) * plotHeight;
        yBottom -= segmentHeight;
        const color = item.id === "other" ? "#5c5c6d" : actorColors[seriesIndex % actorColors.length];
        return `<rect x="${x.toFixed(2)}" y="${yBottom.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(segmentHeight, .6).toFixed(2)}" fill="${color}" class="ae-stack-segment"></rect>`;
      }).join("");
      const tooltipData = escapeHtml(JSON.stringify({
        kind: "money",
        date,
        label: dailyMetric === "profitUsd" ? "Profit" : dailyMetric === "costUsd" ? "Cost" : "Revenue",
        total: dayTotal,
        items: tooltipItems,
      }));
      const hitArea = `<rect x="${(dateIndex * slot).toFixed(2)}" y="${plotTop}" width="${slot.toFixed(2)}" height="${plotHeight}" class="ae-bar-hit" data-ae-bar-tooltip="${tooltipData}"></rect>`;
      const showLabel = dateIndex === 0 || dateIndex === dates.length - 1 || dateIndex % Math.max(1, Math.ceil(dates.length / 7)) === 0;
      const label = showLabel ? `<text x="${(x + barWidth / 2).toFixed(2)}" y="244" text-anchor="middle" class="ae-stack-date">${escapeHtml(date.slice(8))}</text>` : "";
      return `${segments}${hitArea}${label}`;
    }).join("");

    const legend = chartSeries.map((item, index) => {
      const color = item.id === "other" ? "#5c5c6d" : actorColors[index % actorColors.length];
      return `<span title="${escapeHtml(item.name)}"><i style="background:${color}"></i>${escapeHtml(item.name)}</span>`;
    }).join("");

    return {
      html: `<div class="ae-daily-chart-wrap">
        <svg class="ae-stacked-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily earnings by Actor">${guides}${bars}</svg>
        <div class="ae-stack-axis-title">Day of month</div>
        <div class="ae-actor-legend">${legend}</div>
      </div>`,
      series,
      dates,
      totalsByDate,
    };
  }

  function dailyMixMarkup(data) {
    const chart = stackedActorChart(data);
    const status = dailyLoadStatus[data?.month];
    const captured = Object.keys(data?.actorDaily || {}).length;
    const total = status?.total || data?.actorBreakdown?.actors?.filter((actor) => actor.revenueUsd > 0).length || 0;
    const progress = total ? Math.min(100, (captured / total) * 100) : 0;

    if (!chart) {
      const unsupported = status?.status === "unsupported";
      const waiting = status?.status === "waiting-request";
      return `<div class="ae-empty ae-empty-actors">
        <div class="ae-empty-icon">▥</div>
        <h2>${unsupported ? "Daily Actor filtering unavailable" : waiting ? "Waiting for Apify’s daily request" : "Building the daily Actor chart"}</h2>
        <p>${unsupported ? "This Apify session did not accept actorIds on the profit-margin endpoint. The monthly Actor dashboards still work." : waiting ? "Reload the Monetization page or switch its month once. Loading starts when Apify requests profit-margin for the selected month." : "Keep this Apify Monetization page open while the extension securely loads each Actor’s daily series."}</p>
        ${status?.message ? `<small class="ae-status-error">${escapeHtml(status.message)}</small>` : ""}
      </div>`;
    }

    const metricLabel = dailyMetric === "profitUsd" ? "profit" : dailyMetric === "costUsd" ? "cost" : "revenue";
    const totalValue = chart.series.reduce((sum, item) => sum + item.total, 0);
    const topActor = chart.series[0];
    const topActorShare = totalValue ? topActor.total / totalValue : 0;
    const topThreeShare = totalValue ? chart.series.slice(0, 3).reduce((sum, item) => sum + item.total, 0) / totalValue : 0;
    const peakIndex = chart.totalsByDate.indexOf(Math.max(...chart.totalsByDate));
    const peakDate = peakIndex >= 0 ? chart.dates[peakIndex] : "";
    const peakValue = peakIndex >= 0 ? chart.totalsByDate[peakIndex] : 0;
    const peakDateLabel = peakDate
      ? new Date(`${peakDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "No activity";

    return `<div class="ae-daily-mix">
      <section class="ae-daily-stack-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Daily earnings by Actor</span><small>Compare each Actor’s revenue, profit, or cost by day</small></div>
          <div class="ae-metric-toggle">
            <button type="button" data-ae-metric="revenueUsd" class="${dailyMetric === "revenueUsd" ? "ae-active" : ""}">Revenue</button>
            <button type="button" data-ae-metric="profitUsd" class="${dailyMetric === "profitUsd" ? "ae-active" : ""}">Profit</button>
            <button type="button" data-ae-metric="costUsd" class="${dailyMetric === "costUsd" ? "ae-active" : ""}">Cost</button>
          </div>
        </div>
        <div class="ae-stat-ledger ae-stat-ledger-4">
          <article><span>Total ${escapeHtml(metricLabel)}</span><strong>${money(totalValue)}</strong><small>Across selected Actors</small></article>
          <article><span>Highest ${escapeHtml(metricLabel)}</span><strong>${money(topActor.total)}</strong><small title="${escapeHtml(topActor.name)}">${escapeHtml(topActor.name)} · ${percent(topActorShare)}</small></article>
          <article><span>Peak day</span><strong>${money(peakValue)}</strong><small>${escapeHtml(peakDateLabel)}</small></article>
          <article><span>Share from top 3 Actors</span><strong>${percent(topThreeShare)}</strong><small>Combined share of total ${escapeHtml(metricLabel)}</small></article>
        </div>
        ${chart.html}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${captured} of ${total} Actors</span></div>` : ""}
      </section>
      <div class="ae-chart-note">Each color represents one Actor. Contributors outside the top 11 are grouped as Other; hover any day for the complete ranked breakdown.</div>
    </div>`;
  }

  const runMetricLabels = {
    ABORTED: "Aborted",
    FAILED: "Failed",
    SUCCEEDED: "Succeeded",
    "TIMED-OUT": "Timed out",
    TOTAL: "Total runs",
    RESULTS: "Results",
  };

  function stackedRunChart(data) {
    const actorRunDaily = data?.actorRunDaily || {};
    const actorInfo = new Map((data?.actorBreakdown?.actors || []).map((actor) => [actor.id, actor]));
    const allSeries = Object.entries(actorRunDaily).filter(([id]) => actorSelected(id)).map(([id, daily]) => ({
      id,
      name: actorInfo.get(id)?.title || actorInfo.get(id)?.name || id,
      daily,
      total: daily.reduce((sum, day) => sum + number(day[runMetric]), 0),
    }));
    const series = allSeries.filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    if (!series.length) return null;

    const dates = [...new Set(allSeries.flatMap((item) => item.daily.map((day) => day.date)))].sort();
    const visible = series.slice(0, 11);
    const remaining = series.slice(11);
    const chartSeries = remaining.length
      ? [...visible, { id: "other", name: `Other (${remaining.length})`, daily: [], total: remaining.reduce((sum, item) => sum + item.total, 0), grouped: remaining }]
      : visible;
    const values = new Map(series.map((item) => [item.id, new Map(item.daily.map((day) => [day.date, number(day[runMetric])]))]));
    const valueFor = (item, date) => item.grouped
      ? item.grouped.reduce((sum, child) => sum + number(values.get(child.id)?.get(date)), 0)
      : number(values.get(item.id)?.get(date));
    const totalsByDate = dates.map((date) => chartSeries.reduce((sum, item) => sum + valueFor(item, date), 0));
    const maxValue = Math.max(...totalsByDate, 1);
    const width = 760;
    const height = 260;
    const plotTop = 10;
    const plotHeight = 210;
    const slot = width / Math.max(dates.length, 1);
    const barWidth = Math.max(5, Math.min(30, slot * .68));

    const guides = [0, .25, .5, .75, 1].map((ratio) => {
      const y = plotTop + plotHeight - plotHeight * ratio;
      return `<g><line x1="0" y1="${y}" x2="${width}" y2="${y}" class="ae-guide"/><text x="0" y="${y - 4}" class="ae-stack-tick">${escapeHtml(compactInteger(maxValue * ratio))}</text></g>`;
    }).join("");
    const bars = dates.map((date, dateIndex) => {
      const x = dateIndex * slot + (slot - barWidth) / 2;
      let yBottom = plotTop + plotHeight;
      const tooltipItems = series.map((item, seriesIndex) => ({
        name: item.name,
        value: number(values.get(item.id)?.get(date)),
        color: seriesIndex < 11 ? actorColors[seriesIndex % actorColors.length] : "#5c5c6d",
      })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
      const dayTotal = tooltipItems.reduce((sum, item) => sum + item.value, 0);
      const segments = chartSeries.map((item, seriesIndex) => {
        const value = valueFor(item, date);
        if (value <= 0) return "";
        const segmentHeight = (value / maxValue) * plotHeight;
        yBottom -= segmentHeight;
        const color = item.id === "other" ? "#5c5c6d" : actorColors[seriesIndex % actorColors.length];
        return `<rect x="${x.toFixed(2)}" y="${yBottom.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(segmentHeight, .7).toFixed(2)}" fill="${color}" class="ae-stack-segment"></rect>`;
      }).join("");
      const tooltipData = escapeHtml(JSON.stringify({ kind: "integer", date, label: runMetricLabels[runMetric], total: dayTotal, items: tooltipItems }));
      const hitArea = `<rect x="${(dateIndex * slot).toFixed(2)}" y="${plotTop}" width="${slot.toFixed(2)}" height="${plotHeight}" class="ae-bar-hit" data-ae-bar-tooltip="${tooltipData}"></rect>`;
      const showLabel = dateIndex === 0 || dateIndex === dates.length - 1 || dateIndex % Math.max(1, Math.ceil(dates.length / 7)) === 0;
      const label = showLabel ? `<text x="${(x + barWidth / 2).toFixed(2)}" y="244" text-anchor="middle" class="ae-stack-date">${escapeHtml(date.slice(8))}</text>` : "";
      return `${segments}${hitArea}${label}`;
    }).join("");
    const legend = chartSeries.map((item, index) => {
      const color = item.id === "other" ? "#5c5c6d" : actorColors[index % actorColors.length];
      return `<span title="${escapeHtml(item.name)}"><i style="background:${color}"></i>${escapeHtml(item.name)}</span>`;
    }).join("");

    return {
      html: `<div class="ae-daily-chart-wrap"><svg class="ae-stacked-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily ${escapeHtml(runMetricLabels[runMetric])} by Actor">${guides}${bars}</svg><div class="ae-stack-axis-title">Day of month</div><div class="ae-actor-legend">${legend}</div></div>`,
      series,
      dates,
      totalsByDate,
    };
  }

  function dailyRunsMarkup(data) {
    const chart = stackedRunChart(data);
    const status = runLoadStatus[data?.month];
    const captured = Object.keys(data?.actorRunDaily || {}).length;
    const totalActors = status?.total || data?.actorBreakdown?.actors?.length || 0;
    const progress = totalActors ? Math.min(100, (captured / totalActors) * 100) : 0;
    const unsupported = status?.status === "unsupported";
    const totalValue = chart?.series.reduce((sum, item) => sum + item.total, 0) || 0;
    const peakIndex = chart ? chart.totalsByDate.indexOf(Math.max(...chart.totalsByDate)) : -1;
    const peakDate = peakIndex >= 0 ? chart.dates[peakIndex] : null;
    const peakValue = peakIndex >= 0 ? chart.totalsByDate[peakIndex] : 0;

    return `<div class="ae-daily-runs">
      <section class="ae-daily-stack-card">
        <div class="ae-card-heading ae-section-heading ae-run-heading">
          <div><span>Daily run activity by Actor</span><small>Compare run outcomes and result volume by day</small></div>
          <div class="ae-run-metric-toggle">
            ${Object.entries(runMetricLabels).map(([key, label]) => `<button type="button" data-ae-run-metric="${escapeHtml(key)}" class="${runMetric === key ? "ae-active" : ""}">${escapeHtml(label)}</button>`).join("")}
          </div>
        </div>
        <div class="ae-run-summary ae-stat-ledger ae-stat-ledger-3">
          <article><span>${escapeHtml(runMetricLabels[runMetric])}</span><strong>${integer(totalValue)}</strong><small>Across loaded Actors</small></article>
          <article><span>Active Actors</span><strong>${integer(chart?.series.length || 0)}</strong><small>Actors reporting this metric</small></article>
          <article><span>Peak day</span><strong>${integer(peakValue)}</strong><small>${escapeHtml(peakDate || "No activity")}</small></article>
        </div>
        ${chart ? chart.html : `<div class="ae-run-empty"><strong>${unsupported ? "Daily run statistics unavailable" : status?.status === "waiting-request" ? "Waiting for Apify analytics" : `No ${escapeHtml(runMetricLabels[runMetric].toLowerCase())} recorded`}</strong><span>${unsupported ? escapeHtml(status?.message || "The endpoint request failed.") : status?.status === "waiting-request" ? "Reload the Monetization page or switch its month once." : status?.status === "loading" ? "Actor data is still loading." : "Choose another metric to inspect activity."}</span></div>`}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${captured} of ${totalActors} Actors</span></div>` : ""}
      </section>
    </div>`;
  }

  const userMetricLabels = {
    payingUsers: "Paying users",
    freeUsers: "Free users",
    totalUsers: "Total users",
  };

  function stackedUserChart(data) {
    const actorUserDaily = data?.actorUserDaily || {};
    const actorInfo = new Map((data?.actorBreakdown?.actors || []).map((actor) => [actor.id, actor]));
    const allSeries = Object.entries(actorUserDaily).filter(([id]) => actorSelected(id)).map(([id, daily]) => {
      const visibleDaily = daily.filter((day) => dateIsVisibleForMonth(day.date, data?.month));
      return {
        id,
        name: actorInfo.get(id)?.title || actorInfo.get(id)?.name || id,
        daily: visibleDaily,
        total: visibleDaily.reduce((sum, day) => sum + number(day[userMetric]), 0),
      };
    });
    const series = allSeries.filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    if (!series.length) return null;

    const dates = [...new Set(allSeries.flatMap((item) => item.daily.map((day) => day.date)))].sort();
    const visible = series.slice(0, 11);
    const remaining = series.slice(11);
    const chartSeries = remaining.length
      ? [...visible, { id: "other", name: `Other (${remaining.length})`, grouped: remaining }]
      : visible;
    const values = new Map(series.map((item) => [item.id, new Map(item.daily.map((day) => [day.date, number(day[userMetric])]))]));
    const valueFor = (item, date) => item.grouped
      ? item.grouped.reduce((sum, child) => sum + number(values.get(child.id)?.get(date)), 0)
      : number(values.get(item.id)?.get(date));
    const totalsByDate = dates.map((date) => chartSeries.reduce((sum, item) => sum + valueFor(item, date), 0));
    const maxValue = Math.max(...totalsByDate, 1);
    const width = 760;
    const height = 260;
    const plotTop = 10;
    const plotHeight = 210;
    const slot = width / Math.max(dates.length, 1);
    const barWidth = Math.max(5, Math.min(30, slot * .68));
    const guides = [0, .25, .5, .75, 1].map((ratio) => {
      const y = plotTop + plotHeight - plotHeight * ratio;
      return `<g><line x1="0" y1="${y}" x2="${width}" y2="${y}" class="ae-guide"/><text x="0" y="${y - 4}" class="ae-stack-tick">${escapeHtml(compactInteger(maxValue * ratio))}</text></g>`;
    }).join("");
    const bars = dates.map((date, dateIndex) => {
      const x = dateIndex * slot + (slot - barWidth) / 2;
      let yBottom = plotTop + plotHeight;
      const tooltipItems = series.map((item, seriesIndex) => ({
        name: item.name,
        value: number(values.get(item.id)?.get(date)),
        color: seriesIndex < 11 ? actorColors[seriesIndex % actorColors.length] : "#5c5c6d",
      })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
      const dayTotal = tooltipItems.reduce((sum, item) => sum + item.value, 0);
      const segments = chartSeries.map((item, seriesIndex) => {
        const value = valueFor(item, date);
        if (value <= 0) return "";
        const segmentHeight = (value / maxValue) * plotHeight;
        yBottom -= segmentHeight;
        const color = item.id === "other" ? "#5c5c6d" : actorColors[seriesIndex % actorColors.length];
        return `<rect x="${x.toFixed(2)}" y="${yBottom.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(segmentHeight, .7).toFixed(2)}" fill="${color}" class="ae-stack-segment"></rect>`;
      }).join("");
      const tooltipData = escapeHtml(JSON.stringify({ kind: "integer", date, label: userMetricLabels[userMetric], total: dayTotal, items: tooltipItems }));
      const hitArea = `<rect x="${(dateIndex * slot).toFixed(2)}" y="${plotTop}" width="${slot.toFixed(2)}" height="${plotHeight}" class="ae-bar-hit" data-ae-bar-tooltip="${tooltipData}"></rect>`;
      const showLabel = dateIndex === 0 || dateIndex === dates.length - 1 || dateIndex % Math.max(1, Math.ceil(dates.length / 7)) === 0;
      const label = showLabel ? `<text x="${(x + barWidth / 2).toFixed(2)}" y="244" text-anchor="middle" class="ae-stack-date">${escapeHtml(date.slice(8))}</text>` : "";
      return `${segments}${hitArea}${label}`;
    }).join("");
    const legend = chartSeries.map((item, index) => {
      const color = item.id === "other" ? "#5c5c6d" : actorColors[index % actorColors.length];
      return `<span title="${escapeHtml(item.name)}"><i style="background:${color}"></i>${escapeHtml(item.name)}</span>`;
    }).join("");
    return {
      html: `<div class="ae-daily-chart-wrap"><svg class="ae-stacked-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily ${escapeHtml(userMetricLabels[userMetric])} by Actor">${guides}${bars}</svg><div class="ae-stack-axis-title">Day of month</div><div class="ae-actor-legend">${legend}</div></div>`,
      series,
      dates,
      totalsByDate,
    };
  }

  function dailyUsersMarkup(data) {
    const chart = stackedUserChart(data);
    const status = userLoadStatus[data?.month];
    const captured = Object.keys(data?.actorUserDaily || {}).length;
    const totalActors = status?.total || data?.actorBreakdown?.actors?.length || 0;
    const progress = totalActors ? Math.min(100, (captured / totalActors) * 100) : 0;
    const selectedUserSeries = Object.entries(data?.actorUserDaily || {})
      .filter(([id]) => actorSelected(id))
      .map(([id, daily]) => [id, daily.filter((day) => dateIsVisibleForMonth(day.date, data?.month))]);
    const payingTotal = selectedUserSeries.reduce((sum, [, daily]) => sum + daily.reduce((inner, day) => inner + day.payingUsers, 0), 0);
    const freeTotal = selectedUserSeries.reduce((sum, [, daily]) => sum + daily.reduce((inner, day) => inner + day.freeUsers, 0), 0);
    const payingShare = payingTotal + freeTotal ? payingTotal / (payingTotal + freeTotal) : 0;
    const userOccurrenceTotal = payingTotal + freeTotal;
    const unsupported = status?.status === "unsupported";
    const coverage = chart?.dates?.at(-1)
      ? ` · through ${new Date(`${chart.dates.at(-1)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "";

    return `<div class="ae-daily-users">
      <section class="ae-daily-stack-card">
        <div class="ae-card-heading ae-section-heading ae-run-heading">
          <div><span>Daily user activity by Actor</span><small>Actor-user occurrences${escapeHtml(coverage)} · the same person may appear under multiple Actors</small></div>
          <div class="ae-user-metric-toggle">
            ${Object.entries(userMetricLabels).map(([key, label]) => `<button type="button" data-ae-user-metric="${key}" class="${userMetric === key ? "ae-active" : ""}">${escapeHtml(label)}</button>`).join("")}
          </div>
        </div>
        <div class="ae-run-summary ae-stat-ledger ae-stat-ledger-4">
          <article><span>Total user activity</span><strong>${integer(userOccurrenceTotal)}</strong><small>Actor-user occurrences</small></article>
          <article><span>Paying users</span><strong>${integer(payingTotal)}</strong><small>Occurrences across selected Actors</small></article>
          <article><span>Free users</span><strong>${integer(freeTotal)}</strong><small>Occurrences across selected Actors</small></article>
          <article><span>Paying share</span><strong>${percent(payingShare)}</strong><small>Paying ÷ total activity</small></article>
        </div>
        ${chart ? chart.html : `<div class="ae-run-empty"><strong>${unsupported ? "Daily user statistics unavailable" : status?.status === "waiting-request" ? "Waiting for Apify analytics" : `No ${escapeHtml(userMetricLabels[userMetric].toLowerCase())} recorded`}</strong><span>${unsupported ? escapeHtml(status?.message || "The endpoint request failed.") : status?.status === "loading" ? "Actor data is still loading." : "Choose another user metric to inspect."}</span></div>`}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${captured} of ${totalActors} Actors</span></div>` : ""}
      </section>
    </div>`;
  }

  function actorQualityMarkup(data) {
    const actors = selectedActors(data);
    const status = qualityLoadStatus[data?.month];
    if (!actors.length) {
      return `<div class="ae-empty ae-empty-actors"><div class="ae-empty-icon">◇</div><h2>No Actors selected</h2><p>Choose one or more Actors to inspect their quality signals.</p></div>`;
    }

    const loaded = actors.map((actor) => actorQuality[actor.id]).filter(Boolean);
    const scored = loaded.filter((item) => item.hasQualityScore);
    const averageQuality = scored.length ? scored.reduce((sum, item) => sum + item.quality, 0) / scored.length : 0;
    const strongActors = scored.filter((item) => item.quality >= .8).length;
    const actionItems = loaded.reduce((sum, item) => sum + item.improvements.length, 0);
    const bestPercentile = scored.length ? Math.max(...scored.map((item) => item.qualityPercentile)) : 0;
    const progress = actors.length ? Math.min(100, (loaded.length / actors.length) * 100) : 0;
    const sorted = [...actors].sort((a, b) => {
      const left = actorQuality[a.id];
      const right = actorQuality[b.id];
      if (left && !right) return -1;
      if (!left && right) return 1;
      if (left?.hasQualityScore && !right?.hasQualityScore) return -1;
      if (!left?.hasQualityScore && right?.hasQualityScore) return 1;
      return number(right?.quality) - number(left?.quality) || a.title.localeCompare(b.title);
    });
    const dateLabel = (value) => value
      ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "—";
    const check = (label, passed) => `<span class="ae-quality-check ${passed ? "ae-pass" : "ae-missing"}"><i>${passed ? "✓" : "×"}</i>${escapeHtml(label)}</span>`;

    const rows = sorted.map((actor) => {
      const quality = actorQuality[actor.id];
      const expanded = expandedQualityActorIds.has(actor.id);
      const picture = quality?.pictureUrl || actor.pictureUrl;
      const title = quality?.title || actor.title;
      const name = quality?.name || actor.name;
      const qualityTone = !quality?.hasQualityScore ? "" : quality.quality >= .8 ? "ae-quality-good" : quality.quality >= .6 ? "ae-quality-medium" : "ae-quality-low";
      const qualityValue = quality?.hasQualityScore ? `${(quality.quality * 100).toFixed(1)}` : "—";
      const rating = quality?.reviewCount ? `${quality.reviewRating.toFixed(1)}` : "—";
      const details = quality && expanded ? `<div class="ae-quality-details">
        <div class="ae-quality-checks">
          ${check("Input schema", quality.hasInputSchema)}
          ${check("Output schema", quality.hasOutputSchema)}
          ${check("README", quality.hasReadme)}
          <span class="ae-quality-category">${quality.isPublic ? "public" : "private"}</span>
          <span class="ae-quality-category">${escapeHtml(quality.pricingModel.replaceAll("_", " ").toLowerCase())}</span>
          ${quality.memoryMbytes ? `<span class="ae-quality-category">${integer(quality.memoryMbytes)} MB memory</span>` : ""}
          ${quality.timeoutSecs ? `<span class="ae-quality-category">${integer(quality.timeoutSecs)}s timeout</span>` : ""}
          ${quality.isDeprecated ? '<span class="ae-quality-category ae-quality-category-alert">deprecated</span>' : ""}
          ${quality.categories.map((category) => `<span class="ae-quality-category">${escapeHtml(category.replaceAll("_", " ").toLowerCase())}</span>`).join("")}
        </div>
        ${quality.description ? `<p class="ae-quality-description">${escapeHtml(quality.description)}</p>` : ""}
        <div class="ae-quality-detail-grid">
          <div><span>Total runs</span><strong>${integer(quality.totalRuns)}</strong><small>${integer(quality.runs30Days.total)} in the last 30 days</small></div>
          <div><span>Total builds</span><strong>${integer(quality.totalBuilds)}</strong><small>Created ${escapeHtml(dateLabel(quality.createdAt))}</small></div>
          <div><span>Users · 7 / 30 / 90d</span><strong>${integer(quality.users7Days)} / ${integer(quality.users30Days)} / ${integer(quality.users90Days)}</strong><small>${integer(quality.totalUsers)} lifetime users</small></div>
          <div><span>Last run</span><strong>${escapeHtml(dateLabel(quality.lastRunStartedAt))}</strong><small>Published ${escapeHtml(dateLabel(quality.firstPublishedAt))}</small></div>
          <div><span>30d failures</span><strong>${integer(quality.runs30Days.failed)}</strong><small>${integer(quality.runs30Days.aborted)} aborted · ${integer(quality.runs30Days.timedOut)} timed out</small></div>
          <div><span>Issue response</span><strong>${quality.issueResponseTimeDays == null ? "—" : `${quality.issueResponseTimeDays.toFixed(1)}d`}</strong><small>${quality.errors.length ? `${quality.errors.length} source request unavailable` : "All quality sources loaded"}</small></div>
        </div>
        <div class="ae-quality-feedback-grid">
          <section>
            <div class="ae-quality-feedback-title"><span class="ae-quality-feedback-icon ae-praise">↑</span><div><strong>Praises</strong><small>${quality.praises.length} strengths recognized</small></div></div>
            <div class="ae-quality-feedback-list">${quality.praises.map((item) => `<article class="ae-quality-feedback-item"><div><strong>${escapeHtml(item.title)}</strong><span>${(item.percentile * 100).toFixed(1)}th percentile</span></div><p>${escapeHtml(item.description)}</p></article>`).join("") || '<div class="ae-quality-feedback-empty">No praise signals reported yet.</div>'}</div>
          </section>
          <section>
            <div class="ae-quality-feedback-title"><span class="ae-quality-feedback-icon ae-improve">!</span><div><strong>Improvements</strong><small>${quality.improvements.length} recommended actions</small></div></div>
            <div class="ae-quality-feedback-list">${quality.improvements.map((item) => `<article class="ae-quality-feedback-item"><div><strong>${escapeHtml(item.title)}</strong>${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Guide ↗</a>` : ""}</div><p>${escapeHtml(item.description)}</p></article>`).join("") || '<div class="ae-quality-feedback-empty">No improvement actions reported.</div>'}</div>
          </section>
        </div>
      </div>` : "";

      return `<article class="ae-quality-row ${expanded ? "ae-expanded" : ""}">
        <button type="button" class="ae-quality-row-main" data-ae-quality-toggle="${escapeHtml(actor.id)}" aria-expanded="${expanded}" ${quality ? "" : "disabled"}>
          <div class="ae-quality-identity">
            <div class="ae-actor-avatar">${picture ? `<img src="${escapeHtml(picture)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<span>${escapeHtml(title.slice(0, 2).toUpperCase())}</span>`}</div>
            <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(name)}</span></div>
          </div>
          <div class="ae-quality-metric ${qualityTone}"><strong>${qualityValue}</strong><span>${quality?.hasQualityScore ? `${(quality.qualityPercentile * 100).toFixed(1)}th percentile` : quality ? "Score unavailable" : status?.status === "loading" ? "Loading…" : "Not loaded"}</span></div>
          <div class="ae-quality-metric"><strong>${quality ? percent(quality.runSuccessRate) : "—"}</strong><span>success rate</span></div>
          <div class="ae-quality-metric"><strong>${quality ? integer(quality.totalUsers) : "—"}</strong><span>users</span></div>
          <div class="ae-quality-metric"><strong>${rating}</strong><span>${quality ? `${integer(quality.reviewCount)} reviews` : "rating"}</span></div>
          <div class="ae-quality-metric"><strong>${quality ? integer(quality.bookmarks) : "—"}</strong><span>bookmarks</span></div>
          <span class="ae-quality-chevron">⌄</span>
        </button>
        ${details}
      </article>`;
    }).join("");

    return `<div class="ae-quality-dashboard">
      <div class="ae-quality-summary ae-stat-ledger ae-stat-ledger-4">
        <article><span>Average quality</span><strong>${scored.length ? `${(averageQuality * 100).toFixed(1)}` : "—"}</strong><small>Across ${scored.length} scored Actors</small></article>
        <article><span>Actors above 80</span><strong>${integer(strongActors)}</strong><small>Quality score of 80 or higher</small></article>
        <article><span>Best percentile</span><strong>${scored.length ? `${(bestPercentile * 100).toFixed(1)}th` : "—"}</strong><small>Portfolio high point</small></article>
        <article><span>Action items</span><strong>${integer(actionItems)}</strong><small>Recommended improvements</small></article>
      </div>
      <section class="ae-quality-list-card">
        <div class="ae-card-heading ae-quality-heading">
          <div><span>Actor quality details</span><small>Store readiness, reliability, adoption, and user feedback</small></div>
          <button type="button" data-ae-quality-refresh>${status?.status === "loading" ? `Loading ${status.completed}/${status.total}` : loaded.length ? "Refresh quality" : "Load quality"}</button>
        </div>
        <div class="ae-quality-list-head"><span>Actor</span><span>Quality</span><span>Success</span><span>Users</span><span>Rating</span><span>Saved</span><span></span></div>
        <div class="ae-quality-list">${rows}</div>
        ${status?.status === "waiting-request" ? `<div class="ae-quality-notice">${escapeHtml(status.message || "Waiting for authenticated Apify data.")}</div>` : ""}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${loaded.length} of ${actors.length} Actors</span></div>` : ""}
      </section>
    </div>`;
  }

  function actorMarketingMarkup(data) {
    const actors = selectedActors(data);
    const marketingByActor = data?.actorMarketing || {};
    const status = marketingLoadStatus[data?.month];
    if (!actors.length) {
      return `<div class="ae-empty ae-empty-actors"><div class="ae-empty-icon">◎</div><h2>No Actors selected</h2><p>Choose one or more Actors to inspect acquisition performance.</p></div>`;
    }

    const tracked = actors.map((actor) => marketingByActor[actor.id]).filter(Boolean);
    const available = tracked.filter((item) => item.available);
    const totals = available.reduce((sum, item) => ({
      webPageViews: sum.webPageViews + item.webPageViews,
      consolePageViews: sum.consolePageViews + item.consolePageViews,
      viewingUsers: sum.viewingUsers + item.viewingUsers,
      usersWithRun: sum.usersWithRun + item.usersWithRun,
    }), { webPageViews: 0, consolePageViews: 0, viewingUsers: 0, usersWithRun: 0 });
    const runViewSignal = totals.viewingUsers ? totals.usersWithRun / totals.viewingUsers : 0;
    const progress = status?.status === "loading" && status.total
      ? Math.min(100, status.completed / status.total * 100)
      : actors.length ? Math.min(100, tracked.length / actors.length * 100) : 0;

    const weightedTraffic = (field) => {
      const weights = new Map();
      for (const actor of available) {
        const weight = Math.max(1, actor.webPageViews + actor.consolePageViews);
        for (const item of actor[field]) weights.set(item.origin, number(weights.get(item.origin)) + weight * item.trafficPercent);
      }
      const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0);
      return [...weights.entries()]
        .map(([origin, value]) => ({ origin, percent: totalWeight ? value / totalWeight * 100 : 0 }))
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 8);
    };
    const referrers = weightedTraffic("topReferrers");
    const countries = weightedTraffic("topCountries");
    const trafficBars = (items, kind) => items.map((item, index) => `<div class="ae-acquisition-bar-row">
      <div><span class="ae-acquisition-rank">${index + 1}</span><strong>${escapeHtml(item.origin)}</strong></div>
      <div class="ae-acquisition-track"><i style="width:${Math.max(1, item.percent).toFixed(1)}%"></i></div>
      <span>${item.percent.toFixed(1)}%</span>
    </div>`).join("") || `<div class="ae-acquisition-empty">No ${escapeHtml(kind)} data reported.</div>`;

    const sorted = [...actors].sort((a, b) => {
      const left = marketingByActor[a.id];
      const right = marketingByActor[b.id];
      if (left?.available && !right?.available) return -1;
      if (!left?.available && right?.available) return 1;
      return number(right?.usersWithRun) - number(left?.usersWithRun) || number(right?.webPageViews) - number(left?.webPageViews) || a.title.localeCompare(b.title);
    });
    const detailTraffic = (items, emptyLabel) => items.map((item) => `<div class="ae-acquisition-detail-row"><strong>${escapeHtml(item.origin)}</strong><div><i style="width:${Math.min(100, item.trafficPercent).toFixed(1)}%"></i></div><span>${item.trafficPercent.toFixed(0)}%</span></div>`).join("") || `<div class="ae-acquisition-empty">${escapeHtml(emptyLabel)}</div>`;
    const rows = sorted.map((actor) => {
      const item = marketingByActor[actor.id];
      const expanded = expandedMarketingActorIds.has(actor.id);
      const signal = item?.viewingUsers ? item.usersWithRun / item.viewingUsers : 0;
      const details = item?.available && expanded ? `<div class="ae-acquisition-details">
        <div class="ae-acquisition-detail-panel"><div class="ae-acquisition-detail-title"><strong>Traffic sources</strong><span>Reported share for this Actor</span></div>${detailTraffic(item.topReferrers, "No referrer data reported.")}</div>
        <div class="ae-acquisition-detail-panel"><div class="ae-acquisition-detail-title"><strong>Audience countries</strong><span>Reported share for this Actor</span></div>${detailTraffic(item.topCountries, "No country data reported.")}</div>
      </div>` : "";
      return `<article class="ae-acquisition-row ${expanded ? "ae-expanded" : ""}">
        <button type="button" class="ae-acquisition-row-main" data-ae-marketing-toggle="${escapeHtml(actor.id)}" aria-expanded="${expanded}" ${item?.available ? "" : "disabled"}>
          <div class="ae-quality-identity">
            <div class="ae-actor-avatar">${actor.pictureUrl ? `<img src="${escapeHtml(actor.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<span>${escapeHtml(actor.title.slice(0, 2).toUpperCase())}</span>`}</div>
            <div><strong>${escapeHtml(actor.title)}</strong><span>${escapeHtml(actor.name)}</span></div>
          </div>
          <div class="ae-acquisition-metric"><strong>${item?.available ? integer(item.webPageViews) : "—"}</strong><span>Store views</span></div>
          <div class="ae-acquisition-metric"><strong>${item?.available ? integer(item.consolePageViews) : "—"}</strong><span>Console views</span></div>
          <div class="ae-acquisition-metric"><strong>${item?.available ? integer(item.viewingUsers) : "—"}</strong><span>Viewing users</span></div>
          <div class="ae-acquisition-metric ae-acquisition-runs"><strong>${item?.available ? integer(item.usersWithRun) : "—"}</strong><span>Users with run</span></div>
          <div class="ae-acquisition-metric"><strong>${item?.available && item.viewingUsers ? percent(signal) : "—"}</strong><span>${item?.error ? "Unavailable" : item ? "Run-to-view ratio" : status?.status === "loading" ? "Loading…" : "Not loaded"}</span></div>
          <span class="ae-quality-chevron">⌄</span>
        </button>
        ${details}
      </article>`;
    }).join("");

    return `<div class="ae-acquisition-dashboard">
      <div class="ae-quality-summary ae-acquisition-summary ae-stat-ledger ae-stat-ledger-4">
        <article><span>Store page views</span><strong>${integer(totals.webPageViews)}</strong><small>Actor-level unique totals</small></article>
        <article><span>Console page views</span><strong>${integer(totals.consolePageViews)}</strong><small>Actor-level unique totals</small></article>
        <article><span>Viewing users</span><strong>${integer(totals.viewingUsers)}</strong><small>Across ${available.length} Actors</small></article>
        <article><span>Users with a run</span><strong>${integer(totals.usersWithRun)}</strong><small>${totals.viewingUsers ? `${percent(runViewSignal)} run-to-view ratio` : "No viewing-user baseline"}</small></article>
      </div>
      <div class="ae-acquisition-insights">
        <section><div class="ae-card-heading"><div><span>Traffic sources</span><small>Portfolio mix weighted by Actor page views</small></div></div>${trafficBars(referrers, "referrer")}</section>
        <section><div class="ae-card-heading"><div><span>Audience locations</span><small>Portfolio mix weighted by Actor page views</small></div></div>${trafficBars(countries, "country")}</section>
      </div>
      <section class="ae-acquisition-list-card">
        <div class="ae-card-heading ae-quality-heading">
          <div><span>Acquisition by Actor</span><small>Actor-level unique counts · the same person may appear under multiple Actors</small></div>
          <button type="button" data-ae-marketing-refresh>${status?.status === "loading" ? `Loading ${status.completed}/${status.total}` : tracked.length ? "Refresh acquisition" : "Load acquisition"}</button>
        </div>
        <div class="ae-acquisition-list-head"><span>Actor</span><span>Store</span><span>Console</span><span>Viewing</span><span>Ran</span><span>Signal</span><span></span></div>
        <div class="ae-acquisition-list">${rows}</div>
        ${status?.status === "waiting-request" ? `<div class="ae-quality-notice">${escapeHtml(status.message || "Waiting for authenticated Apify data.")}</div>` : ""}
        ${status?.status === "complete" && status.failed ? `<div class="ae-quality-notice">${integer(status.failed)} Actor request${status.failed === 1 ? "" : "s"} could not be loaded. Use refresh to retry.</div>` : ""}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Processed ${status.completed} of ${status.total} Actors</span></div>` : ""}
      </section>
      <p class="ae-acquisition-footnote">Run-to-view ratio compares two separately deduplicated groups and can exceed 100%; use it as a directional indicator, not a conversion rate.</p>
    </div>`;
  }

  function actorBreakdownMarkup(data) {
    const breakdown = data?.actorBreakdown;
    if (!breakdown?.actors?.length) {
      return `<div class="ae-empty ae-empty-actors">
        <div class="ae-empty-icon">▦</div>
        <h2>Waiting for actor data</h2>
        <p>Open the actor breakdown in Apify Monetization for this month, then reload or change the month there.</p>
      </div>`;
    }

    const actors = breakdown.actors.filter((actor) => actorSelected(actor.id));
    if (!actors.length) {
      return `<div class="ae-empty ae-empty-actors"><div class="ae-empty-icon">◌</div><h2>No Actors selected</h2><p>Choose one or more Actors from the filter above to populate this view.</p></div>`;
    }
    const maxProfit = Math.max(...actors.map((actor) => actor.profitUsd), 1);
    const totals = actors.reduce((sum, actor) => ({
      revenue: sum.revenue + actor.revenueUsd,
      profit: sum.profit + actor.profitUsd,
      users: sum.users + actor.payingUsers,
      runs: sum.runs + actor.totalRuns,
    }), { revenue: 0, profit: 0, users: 0, runs: 0 });
    const profitChange = change(breakdown.previousMonthProfitUsd, breakdown.currentMonthProfitUsd);

    const topRevenueActors = [...actors]
      .filter((actor) => actor.revenueUsd > 0)
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 12);
    const maxRevenue = Math.max(...topRevenueActors.map((actor) => actor.revenueUsd), 1);
    const portfolioBars = topRevenueActors.map((actor) => {
      const totalWidth = Math.max(1, (actor.revenueUsd / maxRevenue) * 100);
      const profitWidth = actor.revenueUsd ? Math.max(0, Math.min(100, (actor.profitUsd / actor.revenueUsd) * 100)) : 0;
      const costWidth = Math.max(0, 100 - profitWidth);
      const share = totals.revenue ? actor.revenueUsd / totals.revenue : 0;

      return `<div class="ae-portfolio-row">
        <div class="ae-portfolio-name" title="${escapeHtml(actor.title)}"><strong>${escapeHtml(actor.title)}</strong><span>${percent(share)} of revenue</span></div>
        <div class="ae-portfolio-visual">
          <div class="ae-portfolio-track">
            <div class="ae-portfolio-total" style="width:${totalWidth.toFixed(2)}%">
              <i class="ae-profit-segment" style="width:${profitWidth.toFixed(2)}%"></i>
              <i class="ae-cost-segment" style="width:${costWidth.toFixed(2)}%"></i>
            </div>
          </div>
        </div>
        <div class="ae-portfolio-values"><strong>${money(actor.revenueUsd)}</strong><span>${money(actor.profitUsd)} profit</span></div>
      </div>`;
    }).join("");

    const actorsWithHealth = [...actors]
      .map((actor) => ({
        ...actor,
        problemRuns: actor.failedRuns + actor.abortedRuns + actor.timedOutRuns,
      }));
    const unhealthyActors = actorsWithHealth
      .filter((actor) => actor[healthMetric] > 0)
      .sort((a, b) => b[healthMetric] - a[healthMetric]);
    const healthLabels = {
      problemRuns: "all problems",
      failedRuns: "failed runs",
      abortedRuns: "aborted runs",
      timedOutRuns: "timeouts",
      successfulRuns: "successful runs",
    };
    const reliabilityRows = unhealthyActors.map((actor) => {
      const issueRate = actor.totalRuns ? actor.problemRuns / actor.totalRuns : 0;
      const severity = issueRate >= 0.1 || actor.failedRuns >= 100
        ? "critical"
        : issueRate >= 0.02 || actor.problemRuns >= 20 ? "warning" : "low";
      return `<div class="ae-health-row">
        <div class="ae-health-actor"><span class="ae-health-dot ae-${severity}"></span><div><strong>${escapeHtml(actor.title)}</strong><span>${integer(actor.totalRuns)} total runs</span></div></div>
        <div class="ae-health-metric ae-health-success"><strong>${integer(actor.successfulRuns)}</strong><span>successful</span></div>
        <div class="ae-health-metric ae-health-failed"><strong>${integer(actor.failedRuns)}</strong><span>failed</span></div>
        <div class="ae-health-metric ae-health-aborted"><strong>${integer(actor.abortedRuns)}</strong><span>aborted</span></div>
        <div class="ae-health-metric ae-health-timeout"><strong>${integer(actor.timedOutRuns)}</strong><span>timed out</span></div>
        <div class="ae-health-rate"><strong>${percent(issueRate)}</strong><span>issue rate</span></div>
      </div>`;
    }).join("");

    const rows = actors.map((actor, index) => {
      const initials = actor.title.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      const avatar = actor.pictureUrl
        ? `<img src="${escapeHtml(actor.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<span>${escapeHtml(initials || "A")}</span>`;
      const barWidth = Math.max(0, Math.min(100, (actor.profitUsd / maxProfit) * 100));
      const pricing = actor.pricingModel.replaceAll("_", " ").toLowerCase();

      return `<article class="ae-actor-row">
        <div class="ae-actor-rank">${index + 1}</div>
        <div class="ae-actor-avatar">${avatar}</div>
        <div class="ae-actor-identity">
          <strong title="${escapeHtml(actor.title)}">${escapeHtml(actor.title)}</strong>
          <span>${escapeHtml(actor.username ? `${actor.username}/${actor.name}` : actor.name)}</span>
        </div>
        <div class="ae-actor-profit">
          <strong>${money(actor.profitUsd)}</strong>
          <div><i style="width:${barWidth.toFixed(2)}%"></i></div>
          <span>${money(actor.revenueUsd)} revenue · ${money(actor.costUsd)} cost</span>
        </div>
        <div class="ae-actor-stat"><strong>${integer(actor.payingUsers)}</strong><span>paying users</span></div>
        <div class="ae-actor-stat"><strong>${percent(actor.successRate)}</strong><span>${integer(actor.totalRuns)} runs</span></div>
        <div class="ae-actor-stat"><strong>${integer(actor.results)}</strong><span>results</span></div>
        <div class="ae-actor-pricing">${escapeHtml(pricing)}</div>
      </article>`;
    }).join("");

    return `<div class="ae-actors-view">
      <div class="ae-actor-summary ae-stat-ledger ae-stat-ledger-4">
        <article><span>Net profit</span><strong>${money(totals.profit)}</strong><small class="${profitChange !== null && profitChange >= 0 ? "ae-up" : "ae-down"}">${profitChange === null ? "No comparison" : `${profitChange >= 0 ? "↑" : "↓"} ${Math.abs(profitChange * 100).toFixed(1)}% vs previous`}</small></article>
        <article><span>Revenue</span><strong>${money(totals.revenue)}</strong><small>${actors.length} Actors</small></article>
        <article><span>Paying users</span><strong>${integer(totals.users)}</strong><small>Sum across actors</small></article>
        <article><span>Total runs</span><strong>${integer(totals.runs)}</strong><small>For captured month</small></article>
      </div>
      <section class="ae-portfolio-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Revenue, profit, and cost by Actor</span><small>Top Actors for the selected month</small></div>
          <div class="ae-legend"><i class="ae-green"></i>Net profit <i class="ae-orange"></i>Cost</div>
        </div>
        <div class="ae-portfolio-list">${portfolioBars || '<div class="ae-inline-empty">No revenue reported for this month.</div>'}</div>
        <div class="ae-chart-note">Each full bar is an Actor’s revenue. Profit and cost are stacked inside it, so profit + cost = revenue.</div>
      </section>
      <section class="ae-health-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Run reliability by Actor</span><small>Monthly totals · ranked by ${healthLabels[healthMetric]}</small></div>
          <span class="ae-problem-count">${integer(unhealthyActors.reduce((sum, actor) => sum + actor[healthMetric], 0))} ${healthLabels[healthMetric]}</span>
        </div>
        <div class="ae-health-filters">
          <button type="button" data-ae-health="problemRuns" class="${healthMetric === "problemRuns" ? "ae-active" : ""}">All issues</button>
          <button type="button" data-ae-health="failedRuns" class="${healthMetric === "failedRuns" ? "ae-active" : ""}">Failed</button>
          <button type="button" data-ae-health="abortedRuns" class="${healthMetric === "abortedRuns" ? "ae-active" : ""}">Aborted</button>
          <button type="button" data-ae-health="timedOutRuns" class="${healthMetric === "timedOutRuns" ? "ae-active" : ""}">Timed out</button>
          <button type="button" data-ae-health="successfulRuns" class="${healthMetric === "successfulRuns" ? "ae-active" : ""}">Successful</button>
        </div>
        <div class="ae-health-head"><span>Actor</span><span>Success</span><span>Failed</span><span>Aborted</span><span>Timeout</span><span>Rate</span></div>
        <div class="ae-health-list">${reliabilityRows || '<div class="ae-inline-empty">No failed, aborted, or timed-out runs 🎉</div>'}</div>
      </section>
      <section class="ae-actor-list-card">
        <div class="ae-card-heading ae-actor-heading">
          <div><span>Actor performance table</span><small>Ranked by net profit</small></div>
          <small>Revenue, usage and reliability</small>
        </div>
        <div class="ae-actor-list">${rows}</div>
      </section>
      <footer>Actor breakdown captured locally ${new Date(breakdown.capturedAt).toLocaleString()}</footer>
    </div>`;
  }

  function overviewSparkline(daily) {
    const width = 520;
    const height = 112;
    const revenue = daily.map((day) => day.revenueUsd);
    const profit = daily.map((day) => day.profitUsd);
    const maxValue = Math.max(...revenue, ...profit, 1);
    const minValue = Math.min(...profit, 0);
    const revenuePath = linePath(revenue, width, height, minValue, maxValue);
    const profitPath = linePath(profit, width, height, minValue, maxValue);
    const span = maxValue - minValue || 1;
    const xFor = (index) => daily.length > 1 ? index * width / (daily.length - 1) : width / 2;
    const yFor = (value) => height - ((value - minValue) / span) * height;
    const step = daily.length > 1 ? width / (daily.length - 1) : width;
    const hoverTargets = daily.map((day, index) => {
      const previousDay = daily[index - 1];
      const x = xFor(index);
      const zoneLeft = daily.length === 1 ? 0 : Math.max(0, x - step / 2);
      const zoneRight = daily.length === 1 ? width : Math.min(width, x + step / 2);
      const revenueChange = previousDay?.revenueUsd
        ? (day.revenueUsd - previousDay.revenueUsd) / Math.abs(previousDay.revenueUsd)
        : null;
      const profitChange = previousDay?.profitUsd
        ? (day.profitUsd - previousDay.profitUsd) / Math.abs(previousDay.profitUsd)
        : null;
      const payload = escapeHtml(JSON.stringify({
        date: day.date,
        revenueUsd: day.revenueUsd,
        profitUsd: day.profitUsd,
        costUsd: day.costUsd,
        margin: day.revenueUsd ? day.profitUsd / day.revenueUsd : 0,
        revenueChange,
        profitChange,
        previousRevenueUsd: previousDay ? previousDay.revenueUsd : null,
        previousProfitUsd: previousDay ? previousDay.profitUsd : null,
      }));
      return `<g class="ae-overview-pulse-hit" data-ae-pulse-tooltip="${payload}">
        <line x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="${height}" class="ae-overview-pulse-guide" />
        <circle cx="${x.toFixed(2)}" cy="${yFor(day.revenueUsd).toFixed(2)}" r="3.5" class="ae-overview-pulse-point ae-revenue-point" />
        <circle cx="${x.toFixed(2)}" cy="${yFor(day.profitUsd).toFixed(2)}" r="3.5" class="ae-overview-pulse-point ae-profit-point" />
        <rect x="${zoneLeft.toFixed(2)}" y="0" width="${Math.max(1, zoneRight - zoneLeft).toFixed(2)}" height="${height}" class="ae-overview-pulse-zone" />
      </g>`;
    }).join("");
    const shortDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `<div class="ae-overview-pulse-wrap">
      <svg class="ae-overview-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Interactive daily revenue and profit trend">
        <line x1="0" y1="${height}" x2="${width}" y2="${height}" class="ae-overview-spark-base" />
        <path d="${revenuePath}" class="ae-overview-spark-revenue"></path>
        <path d="${profitPath}" class="ae-overview-spark-profit"></path>
        ${hoverTargets}
      </svg>
      <div class="ae-overview-pulse-range"><span>${escapeHtml(shortDate(daily[0].date))}</span><span>Hover any day for details</span><span>${escapeHtml(shortDate(daily.at(-1).date))}</span></div>
    </div>`;
  }

  function commandOverviewMarkup(data, overviewData, previous) {
    const actors = selectedActors(data);
    const comparisonMonth = offsetMonth(data.month, -1);
    const comparisonState = monthLoadStatus[comparisonMonth];
    const comparisonLabel = new Date(`${comparisonMonth}-02T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const previousActors = new Map((previous?.actorBreakdown?.actors || []).map((actor) => [actor.id, actor]));
    const [year, monthNumber] = data.month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const currentMonth = localDateKey().slice(0, 7);
    const isCurrentMonth = data.month === currentMonth;
    const lastDataDay = Math.max(...overviewData.daily.map((day) => number(day.date.slice(8))), 1);
    const reportedDay = isCurrentMonth ? Math.min(lastDataDay, number(localDateKey().slice(8))) : lastDataDay;
    const paceFactor = isCurrentMonth ? daysInMonth / Math.min(reportedDay, daysInMonth) : 1;
    const pacedRevenue = overviewData.total.revenueUsd * paceFactor;
    const pacedProfit = overviewData.total.profitUsd * paceFactor;
    const revenueChange = previous?.total ? change(previous.total.revenueUsd, pacedRevenue) : null;
    const profitChange = previous?.total ? change(previous.total.profitUsd, pacedProfit) : null;
    const trend = (value, fallback = "No previous period") => value === null
      ? `<span class="ae-muted">${fallback}</span>`
      : `<span class="${value >= 0 ? "ae-up" : "ae-down"}">${value >= 0 ? "↑" : "↓"} ${Math.abs(value * 100).toFixed(1)}% ${isCurrentMonth ? "projected vs previous" : "vs previous"}</span>`;
    const bestDay = overviewData.daily.reduce((best, day) => day.profitUsd > best.profitUsd ? day : best, overviewData.daily[0]);
    const latestDay = overviewData.daily.at(-1);
    const avgRevenue = overviewData.total.revenueUsd / Math.max(overviewData.daily.length, 1);

    const actorRevenueTotal = actors.reduce((sum, actor) => sum + actor.revenueUsd, 0);
    const contributors = [...actors].sort((a, b) => b.revenueUsd - a.revenueUsd);
    const concentration = (count) => actorRevenueTotal
      ? contributors.slice(0, count).reduce((sum, actor) => sum + actor.revenueUsd, 0) / actorRevenueTotal
      : 0;
    const contributorRows = contributors.slice(0, 5).map((actor, index) => {
      const share = actorRevenueTotal ? actor.revenueUsd / actorRevenueTotal : 0;
      return `<div class="ae-overview-contributor">
        <span class="ae-overview-rank">${index + 1}</span>
        <div class="ae-overview-actor"><strong>${escapeHtml(actor.title)}</strong><span>${percent(share)} of revenue</span></div>
        <div class="ae-overview-share"><i style="width:${Math.max(1, share * 100).toFixed(1)}%"></i></div>
        <div class="ae-overview-money"><strong>${compactMoney(actor.revenueUsd)}</strong><span>${compactMoney(actor.profitUsd)} profit</span></div>
      </div>`;
    }).join("") || '<div class="ae-overview-empty">No Actor revenue data.</div>';

    const movers = previous ? actors.map((actor) => {
      const previousActor = previousActors.get(actor.id);
      const comparableRevenue = actor.revenueUsd * paceFactor;
      const deltaUsd = comparableRevenue - number(previousActor?.revenueUsd);
      const delta = previousActor?.revenueUsd ? deltaUsd / Math.abs(previousActor.revenueUsd) : null;
      const firstPublishedMonth = String(actorQuality[actor.id]?.firstPublishedAt || "").slice(0, 7);
      const confirmedNew = Boolean(!previousActor && previous?.month && firstPublishedMonth && firstPublishedMonth > previous.month);
      return { actor, comparableRevenue, deltaUsd, delta, hasBaseline: Boolean(previousActor), confirmedNew };
    }).filter((item) => item.actor.revenueUsd > 0 || item.deltaUsd !== 0)
      .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd)).slice(0, 5) : [];
    const moverRows = movers.map((item) => {
      const tone = item.hasBaseline ? (item.deltaUsd >= 0 ? "ae-up" : "ae-down") : "ae-muted";
      const status = item.hasBaseline
        ? `${item.delta >= 0 ? "+" : ""}${(item.delta * 100).toFixed(1)}%`
        : item.confirmedNew ? "New Actor" : "No baseline";
      const statusTitle = item.hasBaseline
        ? "Revenue change against the matching Actor in the previous loaded month"
        : item.confirmedNew
          ? "The Actor was first published after the comparison month"
          : "No matching Actor revenue record exists in the previous loaded month";
      const amount = item.hasBaseline
        ? `${item.deltaUsd >= 0 ? "+" : "−"}${compactMoney(Math.abs(item.deltaUsd))}`
        : `${compactMoney(item.comparableRevenue)} ${isCurrentMonth ? "pace" : "revenue"}`;
      return `<div class="ae-overview-mover">
        <div class="ae-overview-actor"><strong>${escapeHtml(item.actor.title)}</strong><span>${isCurrentMonth ? "Projected month" : "Selected month"}</span></div>
        <strong class="${tone}" title="${escapeHtml(statusTitle)}">${escapeHtml(status)}</strong>
        <span class="${tone}">${escapeHtml(amount)}</span>
      </div>`;
    }).join("") || `<div class="ae-overview-empty">${comparisonState?.status === "loading"
        ? `Loading ${escapeHtml(comparisonLabel)} revenue and Actor data…`
      : comparisonState?.status === "error"
        ? `Could not load ${escapeHtml(comparisonLabel)}. ${escapeHtml(comparisonState.message || "Try again.")}`
        : `Preparing the ${escapeHtml(comparisonLabel)} revenue comparison…`}</div>`;

    const alertsByActor = new Map();
    const addAlert = (actor, priority, type, message, tone) => {
      if (!actor || priority <= number(alertsByActor.get(actor.id)?.priority)) return;
      alertsByActor.set(actor.id, { actor, priority, type, message, tone });
    };
    for (const actor of actors) {
      const failed = actor.failedRuns + actor.timedOutRuns;
      const failureRate = actor.totalRuns ? failed / actor.totalRuns : 0;
      if (failed > 0) addAlert(actor, 80 + failureRate * 100, "Reliability", `${integer(failed)} failed or timed-out runs · ${percent(failureRate)}`, "critical");
      if (actor.profitUsd < 0) addAlert(actor, 95, "Economics", `${money(actor.profitUsd)} net loss this month`, "critical");
      else if (actor.revenueUsd > 0 && actor.margin < .5) addAlert(actor, 70, "Economics", `${percent(actor.margin)} profit margin`, "warning");
      const quality = actorQuality[actor.id];
      if (quality?.hasQualityScore && quality.quality < .7) addAlert(actor, 75, "Quality", `${(quality.quality * 100).toFixed(1)} quality score`, "warning");
      const missingChecks = quality ? [quality.hasInputSchema, quality.hasOutputSchema, quality.hasReadme].filter((value) => !value).length : 0;
      if (missingChecks) addAlert(actor, 55 + missingChecks, "Store readiness", `${missingChecks} quality requirement${missingChecks === 1 ? "" : "s"} missing`, "warning");
      if (quality?.improvements?.length) addAlert(actor, 45 + quality.improvements.length, "Quality", `${quality.improvements.length} recommended improvement${quality.improvements.length === 1 ? "" : "s"}`, "neutral");
      const marketing = data.actorMarketing?.[actor.id];
      const pageViews = number(marketing?.webPageViews) + number(marketing?.consolePageViews);
      if (marketing?.available && pageViews >= 10 && marketing.usersWithRun === 0) addAlert(actor, 72, "Acquisition", `${integer(pageViews)} page views but no users with a run`, "warning");
    }
    const alerts = [...alertsByActor.values()].sort((a, b) => b.priority - a.priority).slice(0, 6);
    const alertRows = alerts.map((alert) => `<div class="ae-overview-alert">
      <span class="ae-overview-alert-dot ae-${alert.tone}"></span>
      <div><strong>${escapeHtml(alert.actor.title)}</strong><span>${escapeHtml(alert.message)}</span></div>
      <small>${escapeHtml(alert.type)}</small>
    </div>`).join("") || '<div class="ae-overview-clear"><span>✓</span><div><strong>No significant issues detected</strong><p>Loaded portfolio signals look healthy.</p></div></div>';

    const totalRuns = actors.reduce((sum, actor) => sum + actor.totalRuns, 0);
    const successfulRuns = actors.reduce((sum, actor) => sum + actor.successfulRuns, 0);
    const portfolioSuccess = totalRuns ? successfulRuns / totalRuns : 0;
    const problemActors = actors.filter((actor) => actor.failedRuns + actor.abortedRuns + actor.timedOutRuns > 0).length;
    const marketing = actors.map((actor) => data.actorMarketing?.[actor.id]).filter((item) => item?.available);
    const marketingTotals = marketing.reduce((sum, item) => ({
      views: sum.views + item.webPageViews + item.consolePageViews,
      runners: sum.runners + item.usersWithRun,
    }), { views: 0, runners: 0 });
    const sources = new Map();
    for (const item of marketing) {
      const weight = Math.max(1, item.webPageViews + item.consolePageViews);
      for (const source of item.topReferrers) sources.set(source.origin, number(sources.get(source.origin)) + weight * source.trafficPercent);
    }
    const topSource = [...sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Not loaded";
    const qualities = actors.map((actor) => actorQuality[actor.id]).filter((item) => item?.hasQualityScore);
    const averageQuality = qualities.length ? qualities.reduce((sum, item) => sum + item.quality, 0) / qualities.length : 0;
    const qualityActions = qualities.reduce((sum, item) => sum + (item.improvements?.length || 0), 0);
    const readinessGaps = qualities.reduce((sum, item) => sum + [item.hasInputSchema, item.hasOutputSchema, item.hasReadme].filter((value) => !value).length, 0);

    return `<div class="ae-command-overview">
      <section class="ae-overview-summary">
        <div class="ae-overview-summary-primary">
          <span>Portfolio revenue</span>
          <strong>${money(overviewData.total.revenueUsd)}</strong>
          ${trend(revenueChange)}
        </div>
        <div class="ae-overview-summary-metrics">
          <article><span>Net profit</span><strong>${money(overviewData.total.profitUsd)}</strong>${trend(profitChange)}</article>
          <article><span>Profit margin</span><strong>${percent(overviewData.total.margin)}</strong><small>After platform and run costs</small></article>
          <article><span>Operating cost</span><strong>${money(overviewData.total.costUsd)}</strong><small>${percent(overviewData.total.revenueUsd ? overviewData.total.costUsd / overviewData.total.revenueUsd : 0)} of revenue</small></article>
          <article><span>${isCurrentMonth ? "Revenue forecast" : "Final revenue"}</span><strong>${money(pacedRevenue)}</strong><small>${isCurrentMonth ? `${reportedDay} of ${daysInMonth} days reported` : `${overviewData.daily.length} reported days`}</small></article>
        </div>
      </section>

      <div class="ae-overview-primary-grid">
        <section class="ae-overview-card ae-overview-trend-card">
          <div class="ae-card-heading"><div><span>Daily financial trend</span><small>Portfolio revenue and profit by day · hover for details</small></div><div class="ae-legend"><i class="ae-purple"></i>Revenue <i class="ae-green"></i>Profit</div></div>
          ${overviewSparkline(overviewData.daily)}
          <div class="ae-overview-trend-stats">
            <div><span>Latest revenue</span><strong>${money(latestDay.revenueUsd)}</strong><small>${escapeHtml(latestDay.date)}</small></div>
            <div><span>Latest profit</span><strong>${money(latestDay.profitUsd)}</strong><small>${percent(latestDay.revenueUsd ? latestDay.profitUsd / latestDay.revenueUsd : 0)} margin</small></div>
            <div><span>Best profit day</span><strong>${money(bestDay.profitUsd)}</strong><small>${escapeHtml(bestDay.date)}</small></div>
            <div><span>Average revenue</span><strong>${money(avgRevenue)}</strong><small>${money(pacedProfit)} projected profit</small></div>
          </div>
        </section>
        <section class="ae-overview-card ae-overview-attention-card">
          <div class="ae-card-heading"><div><span>Priority alerts</span><small>${alerts.length ? `${alerts.length} portfolio signals to review` : "No urgent portfolio signals"}</small></div><button type="button" data-ae-go-to="runs">Run activity →</button></div>
          <div class="ae-overview-alerts">${alertRows}</div>
        </section>
      </div>

      <div class="ae-overview-secondary-grid">
        <section class="ae-overview-card">
          <div class="ae-card-heading"><div><span>Top revenue Actors</span><small>Top 1: ${percent(concentration(1))} · Top 3: ${percent(concentration(3))}</small></div><button type="button" data-ae-go-to="actors">Actor performance →</button></div>
          <div class="ae-overview-contributors">${contributorRows}</div>
        </section>
        <section class="ae-overview-card">
          <div class="ae-card-heading"><div><span>Revenue change by Actor</span><small>${previous ? `${isCurrentMonth ? "Projected" : "Actual"} revenue vs ${escapeHtml(previous.month || "previous period")}` : `Compare with ${escapeHtml(comparisonLabel)}`}</small></div>${!previous && comparisonState?.status === "error" ? `<button type="button" class="ae-comparison-load" data-ae-load-comparison="${escapeHtml(comparisonMonth)}">Retry</button>` : ""}</div>
          <div class="ae-overview-movers">${moverRows}</div>
        </section>
      </div>

      <div class="ae-overview-snapshot-grid">
        <section class="ae-overview-snapshot"><div class="ae-overview-snapshot-head"><span class="ae-overview-snapshot-icon ae-health-icon">✓</span><button type="button" data-ae-go-to="runs">Run reliability →</button></div><strong>${percent(portfolioSuccess)}</strong><span>run success rate</span><div><b>${integer(problemActors)}</b> Actors with run issues · <b>${integer(totalRuns)}</b> total runs</div></section>
        <section class="ae-overview-snapshot"><div class="ae-overview-snapshot-head"><span class="ae-overview-snapshot-icon ae-acquisition-icon">◎</span><button type="button" data-ae-go-to="acquisition">Acquisition →</button></div><strong>${integer(marketingTotals.runners)}</strong><span>users who ran an Actor</span><div><b>${integer(marketingTotals.views)}</b> page views · Top source: <b>${escapeHtml(topSource)}</b></div></section>
        <section class="ae-overview-snapshot"><div class="ae-overview-snapshot-head"><span class="ae-overview-snapshot-icon ae-quality-icon">◇</span><button type="button" data-ae-go-to="quality">Actor quality →</button></div><strong>${qualities.length ? (averageQuality * 100).toFixed(1) : "—"}</strong><span>average quality score</span><div><b>${integer(readinessGaps)}</b> readiness gaps · <b>${integer(qualityActions)}</b> actions</div></section>
      </div>
      <footer>Captured locally ${new Date(overviewData.capturedAt).toLocaleString()}</footer>
    </div>`;
  }

  function dashboardMarkup(data) {
    if (!data) {
      return `<div class="ae-empty">
        <div class="ae-empty-icon">↗</div>
        <h2>Waiting for earnings data</h2>
        <p>Open the Apify Monetization dashboard, then reload the page. This extension will visualize the response locally.</p>
      </div>`;
    }

    const overviewData = overviewForSelection(data);
    const hasOverview = Array.isArray(overviewData.daily) && overviewData.daily.length > 0 && overviewData.total;
    const monthLabel = new Date(`${data.month}-02T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const controlMonth = pendingMonth || data.month;
    const [selectedYear, selectedMonthNumber] = controlMonth.split("-");
    const currentYear = new Date().getFullYear();
    const years = [...new Set([
      ...Object.keys(months).map((key) => Number(key.slice(0, 4))),
      ...Array.from({ length: 7 }, (_, index) => currentYear - index),
    ])].filter(Number.isFinite).sort((a, b) => b - a);
    const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2020, index, 1).toLocaleDateString("en-US", { month: "short" }));
    const actorsForPicker = data.actorBreakdown?.actors || [];
    const pickedCount = selectedActorIds === null ? actorsForPicker.length : actorsForPicker.filter((actor) => selectedActorIds.has(actor.id)).length;
    const actorFilterLabel = selectedActorIds === null ? "All Actors" : `${pickedCount} selected`;
    const loadState = monthLoadStatus[controlMonth];
    const shellStart = `<div class="ae-dashboard">
      <div class="ae-period-row">
        <div>
          <div class="ae-eyebrow">Actor portfolio</div>
          <h2>${escapeHtml(monthLabel)}</h2>
        </div>
        <div class="ae-dashboard-controls">
          <div class="ae-period-picker">
            <select id="ae-month-number" aria-label="Month">${monthNames.map((name, index) => { const value = String(index + 1).padStart(2, "0"); return `<option value="${value}" ${value === selectedMonthNumber ? "selected" : ""}>${escapeHtml(name)}</option>`; }).join("")}</select>
            <select id="ae-year-number" aria-label="Year">${years.map((year) => `<option value="${year}" ${String(year) === selectedYear ? "selected" : ""}>${year}</option>`).join("")}</select>
            <button id="ae-load-month" type="button">${loadState?.status === "loading" ? "Loading…" : "Load"}</button>
          </div>
          <div class="ae-actor-picker ${actorPickerOpen ? "ae-picker-open" : ""}">
            <button id="ae-actor-picker-button" type="button"><span>${escapeHtml(actorFilterLabel)}</span><i>⌄</i></button>
            <div class="ae-actor-picker-menu">
              <div class="ae-picker-actions"><button type="button" data-ae-actors-action="all">Select all</button><button type="button" data-ae-actors-action="none">Clear</button></div>
              <input id="ae-actor-search" type="search" placeholder="Search Actors…" autocomplete="off" />
              <div class="ae-picker-list">
                ${actorsForPicker.map((actor) => `<label data-ae-actor-label="${escapeHtml(`${actor.title} ${actor.name}`.toLowerCase())}"><input type="checkbox" data-ae-actor-id="${escapeHtml(actor.id)}" ${actorSelected(actor.id) ? "checked" : ""}/><span>${escapeHtml(actor.title)}</span><small>${escapeHtml(actor.name)}</small></label>`).join("") || '<div class="ae-picker-empty">Actor data has not loaded yet.</div>'}
              </div>
            </div>
          </div>
        </div>
      </div>
      ${loadState?.status === "error" ? `<div class="ae-month-error">${escapeHtml(loadState.message)}</div>` : ""}
      <nav class="ae-tabs" aria-label="Dashboard sections">
        <button type="button" data-ae-view="overview" class="${activeView === "overview" ? "ae-active" : ""}">Overview</button>
        <button type="button" data-ae-view="daily" class="${activeView === "daily" ? "ae-active" : ""}">Daily earnings <span>${Object.keys(data.actorDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="runs" class="${activeView === "runs" ? "ae-active" : ""}">Run activity <span>${Object.keys(data.actorRunDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="users" class="${activeView === "users" ? "ae-active" : ""}">User activity <span>${Object.keys(data.actorUserDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="actors" class="${activeView === "actors" ? "ae-active" : ""}">Actor performance <span>${pickedCount || ""}</span></button>
        <button type="button" data-ae-view="quality" class="${activeView === "quality" ? "ae-active" : ""}">Actor quality <span>${actorsForPicker.filter((actor) => actorQuality[actor.id]).length || ""}</span></button>
        <button type="button" data-ae-view="acquisition" class="${activeView === "acquisition" ? "ae-active" : ""}">Traffic &amp; acquisition <span>${Object.keys(data.actorMarketing || {}).length || ""}</span></button>
      </nav>`;

    if (!hasOverview) {
      const overviewEmpty = selectedActorIds?.size === 0
        ? '<div class="ae-empty ae-empty-actors"><div class="ae-empty-icon">◌</div><h2>No Actors selected</h2><p>Choose one or more Actors from the filter above to populate this view.</p></div>'
        : '<div class="ae-empty ae-empty-actors"><div class="ae-empty-icon">↗</div><h2>Waiting for daily totals</h2><p>Apify has loaded the Actor breakdown, but not the daily profit-margin series for this selection yet.</p></div>';
      return `${shellStart}
        <div class="ae-view ${activeView === "overview" ? "ae-visible" : ""}" data-ae-section="overview">
          ${overviewEmpty}
        </div>
        <div class="ae-view ${activeView === "daily" ? "ae-visible" : ""}" data-ae-section="daily">${dailyMixMarkup(data)}</div>
        <div class="ae-view ${activeView === "runs" ? "ae-visible" : ""}" data-ae-section="runs">${dailyRunsMarkup(data)}</div>
        <div class="ae-view ${activeView === "users" ? "ae-visible" : ""}" data-ae-section="users">${dailyUsersMarkup(data)}</div>
        <div class="ae-view ${activeView === "actors" ? "ae-visible" : ""}" data-ae-section="actors">${actorBreakdownMarkup(data)}</div>
        <div class="ae-view ${activeView === "quality" ? "ae-visible" : ""}" data-ae-section="quality">${actorQualityMarkup(data)}</div>
        <div class="ae-view ${activeView === "acquisition" ? "ae-visible" : ""}" data-ae-section="acquisition">${actorMarketingMarkup(data)}</div>
      </div>`;
    }

    const previousKey = offsetMonth(data.month, -1);
    const previousData = months[previousKey];
    const previousReady = Array.isArray(previousData?.daily)
      && Array.isArray(previousData?.actorBreakdown?.actors);
    const previous = previousReady ? overviewForSelection(previousData) : null;

    return `${shellStart}
      <div class="ae-view ${activeView === "overview" ? "ae-visible" : ""}" data-ae-section="overview">
        ${commandOverviewMarkup(data, overviewData, previous)}
      </div>
      <div class="ae-view ${activeView === "daily" ? "ae-visible" : ""}" data-ae-section="daily">
        ${dailyMixMarkup(data)}
      </div>
      <div class="ae-view ${activeView === "runs" ? "ae-visible" : ""}" data-ae-section="runs">
        ${dailyRunsMarkup(data)}
      </div>
      <div class="ae-view ${activeView === "users" ? "ae-visible" : ""}" data-ae-section="users">
        ${dailyUsersMarkup(data)}
      </div>
      <div class="ae-view ${activeView === "actors" ? "ae-visible" : ""}" data-ae-section="actors">
        ${actorBreakdownMarkup(data)}
      </div>
      <div class="ae-view ${activeView === "quality" ? "ae-visible" : ""}" data-ae-section="quality">
        ${actorQualityMarkup(data)}
      </div>
      <div class="ae-view ${activeView === "acquisition" ? "ae-visible" : ""}" data-ae-section="acquisition">
        ${actorMarketingMarkup(data)}
      </div>
    </div>`;
  }

  function apifyTheme() {
    const explicitValues = [
      document.documentElement?.getAttribute("data-theme"),
      document.documentElement?.getAttribute("data-color-scheme"),
      document.body?.getAttribute("data-theme"),
      document.body?.getAttribute("data-color-scheme"),
      document.documentElement?.className,
      document.body?.className,
    ].filter((value) => typeof value === "string").join(" ").toLowerCase();
    if (/(^|[\s_-])dark([\s_-]|$)/.test(explicitValues)) return "dark";
    if (/(^|[\s_-])light([\s_-]|$)/.test(explicitValues)) return "light";

    const themedElement = document.querySelector([
      'body > [data-theme="dark"]', 'body > [data-color-scheme="dark"]',
      'body > [data-theme="light"]', 'body > [data-color-scheme="light"]',
      '#root[data-theme]', '#root[data-color-scheme]',
      '#app[data-theme]', '#app[data-color-scheme]',
    ].join(", "));
    const declaredTheme = themedElement?.getAttribute("data-theme") || themedElement?.getAttribute("data-color-scheme");
    if (declaredTheme === "dark" || declaredTheme === "light") return declaredTheme;

    const backgroundElements = [document.querySelector("main"), document.body, document.documentElement].filter(Boolean);
    for (const element of backgroundElements) {
      const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!match || match.length < 3 || (match.length > 3 && match[3] < .15)) continue;
      const [red, green, blue] = match;
      const luminance = (.2126 * red + .7152 * green + .0722 * blue) / 255;
      return luminance < .5 ? "dark" : "light";
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function syncApifyTheme(root = document.getElementById(UI_ID)) {
    if (!root) return;
    const theme = apifyTheme();
    if (root.dataset.aeTheme !== theme) root.dataset.aeTheme = theme;
  }

  function ensureUi() {
    let root = document.getElementById(UI_ID);
    if (root) return root;
    if (!document.documentElement) return null;

    root = document.createElement("div");
    root.id = UI_ID;
    root.innerHTML = `<button id="ae-launcher" type="button" aria-label="Open Apify earnings dashboard">
        <span class="ae-launcher-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M2.5 11.5 6 8l2.2 2.2L13.5 5"/><path d="M9.5 5h4v4"/></svg></span><span id="ae-launcher-label">Earnings</span>
      </button>
      <div id="ae-backdrop"></div>
      <aside id="ae-panel" aria-label="Apify earnings dashboard" aria-hidden="true">
        <header class="ae-panel-header">
          <div class="ae-brand"><div class="ae-logo" aria-hidden="true"><svg viewBox="0 0 18 18"><path d="M3 13.5V9.75M7 13.5V5.75M11 13.5V8M15 13.5V3.5"/></svg></div><div><strong>Actor Analytics</strong><span>Private workspace</span></div></div>
          <div class="ae-panel-actions">
            <button id="ae-fullscreen-toggle" type="button" aria-label="Enter fullscreen analysis" title="Enter fullscreen analysis"></button>
            <button id="ae-close" type="button" aria-label="Close dashboard">×</button>
          </div>
        </header>
        <main id="ae-panel-content"></main>
      </aside>
      <div id="ae-bar-tooltip" role="tooltip" hidden></div>`;
    document.documentElement.appendChild(root);
    syncApifyTheme(root);

    root.querySelector("#ae-launcher").addEventListener("click", () => setPanel(true));
    root.querySelector("#ae-fullscreen-toggle").addEventListener("click", () => setPanelFullscreen(!panelFullscreen));
    root.querySelector("#ae-close").addEventListener("click", () => setPanel(false));
    root.querySelector("#ae-backdrop").addEventListener("click", () => setPanel(false));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !panelOpen) return;
      if (panelFullscreen) setPanelFullscreen(false);
      else setPanel(false);
    });
    updateFullscreenControl(root);
    return root;
  }

  function ensurePinnedLauncher() {
    const header = document.querySelector('[data-test="chart-wrapper"] [data-test="card-header"]');
    const root = document.getElementById(UI_ID);
    if (!header || !root) {
      root?.classList.remove("ae-inline-mounted");
      return;
    }

    let launcher = document.getElementById("ae-inline-launcher");
    if (!launcher || !launcher.isConnected) {
      launcher = document.createElement("button");
      launcher.id = "ae-inline-launcher";
      launcher.type = "button";
      launcher.setAttribute("aria-label", "Open advanced Actor analytics");
      launcher.title = "Open advanced Actor analytics";
      launcher.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.3 2.2 4.45 4.91.72-3.55 3.46.84 4.89L10 13.5l-4.4 2.32.84-4.89L2.9 7.47l4.9-.72L10 2.3Z"/></svg><span>Analytics</span>';
      launcher.addEventListener("click", () => setPanel(true));
      header.appendChild(launcher);
    }
    root.classList.add("ae-inline-mounted");
  }

  function setPanel(open) {
    panelOpen = open;
    const root = ensureUi();
    if (!root) return;
    root.classList.toggle("ae-open", open);
    root.querySelector("#ae-panel").setAttribute("aria-hidden", String(!open));
    if (open) render();
  }

  function updateFullscreenControl(root = document.getElementById(UI_ID)) {
    if (!root) return;
    root.classList.toggle("ae-fullscreen", panelFullscreen);
    const button = root.querySelector("#ae-fullscreen-toggle");
    if (!button) return;
    const label = panelFullscreen ? "Minimize to side panel" : "Enter fullscreen analysis";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(panelFullscreen));
    button.innerHTML = panelFullscreen
      ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3v4.5H3M12.5 3v4.5H17M17 12.5h-4.5V17M3 12.5h4.5V17"/></svg>'
      : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4"/></svg>';
  }

  function setPanelFullscreen(fullscreen) {
    panelFullscreen = Boolean(fullscreen);
    updateFullscreenControl(ensureUi());
  }

  function positionBarTooltip(event, tooltip) {
    const gap = 14;
    const width = tooltip.offsetWidth || 330;
    const height = tooltip.offsetHeight || 300;
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + width > window.innerWidth - 10) left = event.clientX - width - gap;
    if (top + height > window.innerHeight - 10) top = Math.max(10, event.clientY - height - gap);
    tooltip.style.left = `${Math.max(10, left)}px`;
    tooltip.style.top = `${Math.max(10, top)}px`;
  }

  function showBarTooltip(event, payload, tooltip) {
    const total = number(payload.total);
    const valueFormatter = payload.kind === "money" ? money : integer;
    const dateLabel = new Date(`${payload.date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const rows = Array.isArray(payload.items) ? payload.items.map((item, index) => {
      const share = total ? number(item.value) / total : 0;
      return `<div class="ae-tooltip-row">
        <span class="ae-tooltip-rank">${index + 1}</span>
        <i style="background:${escapeHtml(item.color)}"></i>
        <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        <span>${percent(share)}</span>
        <b>${escapeHtml(valueFormatter(item.value))}</b>
      </div>`;
    }).join("") : "";

    tooltip.innerHTML = `<div class="ae-tooltip-header"><div><span>${escapeHtml(dateLabel)}</span><strong>${escapeHtml(payload.label)}</strong></div><div><span>Total</span><strong>${escapeHtml(valueFormatter(total))}</strong></div></div><div class="ae-tooltip-columns"><span>Actor</span><span>Share</span><span>Value</span></div><div class="ae-tooltip-list">${rows || '<div class="ae-tooltip-empty">No activity</div>'}</div><div class="ae-tooltip-footer">${payload.items?.length || 0} contributing Actors · sorted highest first</div>`;
    tooltip.hidden = false;
    positionBarTooltip(event, tooltip);
  }

  function showPulseTooltip(event, payload, tooltip) {
    const dateLabel = new Date(`${payload.date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const movement = (value, previousValue) => value === null || value === undefined
      ? `<small class="ae-muted">${previousValue === 0 ? "Prior day was $0" : "First reported day"}</small>`
      : `<small class="${value >= 0 ? "ae-up" : "ae-down"}">${value >= 0 ? "↑" : "↓"} ${Math.abs(value * 100).toFixed(1)}% vs prior day</small>`;
    tooltip.innerHTML = `<div class="ae-tooltip-header"><div><span>${escapeHtml(dateLabel)}</span><strong>Daily financial trend</strong></div><div><span>Margin</span><strong>${escapeHtml(percent(payload.margin))}</strong></div></div>
      <div class="ae-pulse-tooltip-grid">
        <div><span>Revenue</span><strong>${escapeHtml(money(payload.revenueUsd))}</strong>${movement(payload.revenueChange, payload.previousRevenueUsd)}</div>
        <div><span>Net profit</span><strong>${escapeHtml(money(payload.profitUsd))}</strong>${movement(payload.profitChange, payload.previousProfitUsd)}</div>
        <div><span>Costs</span><strong>${escapeHtml(money(payload.costUsd))}</strong><small>Revenue minus profit</small></div>
        <div><span>Profit margin</span><strong>${escapeHtml(percent(payload.margin))}</strong><small>Profit ÷ revenue</small></div>
      </div>
      <div class="ae-tooltip-footer">Daily totals across the currently selected Actors</div>`;
    tooltip.hidden = false;
    positionBarTooltip(event, tooltip);
  }

  function render() {
    const root = ensureUi();
    if (!root) return;
    const keys = Object.keys(months).sort();
    if (!selectedMonth || !months[selectedMonth]) selectedMonth = keys.at(-1) || null;
    const data = selectedMonth ? months[selectedMonth] : null;
    if (panelOpen && activeView === "overview" && data?.month) {
      const comparisonKey = offsetMonth(data.month, -1);
      const comparisonData = months[comparisonKey];
      const comparisonReady = Array.isArray(comparisonData?.daily)
        && Array.isArray(comparisonData?.actorBreakdown?.actors);
      const comparisonStatus = monthLoadStatus[comparisonKey]?.status;
      if (!comparisonReady && comparisonStatus !== "loading" && comparisonStatus !== "error") {
        comparisonMonthRequest = { target: comparisonKey, returnTo: data.month };
        monthLoadStatus[comparisonKey] = { status: "loading", message: "" };
        window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_MONTH", month: `${comparisonKey}-01`, purpose: "comparison" }, window.location.origin);
      }
    }
    const content = root.querySelector("#ae-panel-content");
    const barTooltip = root.querySelector("#ae-bar-tooltip");
    if (barTooltip) barTooltip.hidden = true;
    content.innerHTML = dashboardMarkup(data);
    const filteredOverview = data ? overviewForSelection(data) : null;
    const actorRevenue = selectedActors(data).reduce((sum, actor) => sum + actor.revenueUsd, 0);
    root.querySelector("#ae-launcher-label").textContent = filteredOverview?.total
      ? compactMoney(filteredOverview.total.revenueUsd)
      : Number.isFinite(actorRevenue) ? compactMoney(actorRevenue) : "Earnings";
    ensurePinnedLauncher();

    content.querySelector("#ae-load-month")?.addEventListener("click", () => {
      const monthNumber = content.querySelector("#ae-month-number")?.value;
      const yearNumber = content.querySelector("#ae-year-number")?.value;
      const key = `${yearNumber}-${monthNumber}`;
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      comparisonMonthRequest = null;
      pendingMonth = key;
      if (months[key]) selectedMonth = key;
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_MONTH", month: `${key}-01` }, window.location.origin);
      render();
    });
    content.querySelector("[data-ae-load-comparison]")?.addEventListener("click", (event) => {
      const key = event.currentTarget.dataset.aeLoadComparison;
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      comparisonMonthRequest = { target: key, returnTo: data.month };
      monthLoadStatus[key] = { status: "loading", message: "" };
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_MONTH", month: `${key}-01`, purpose: "comparison" }, window.location.origin);
      render();
    });
    content.querySelector("#ae-actor-picker-button")?.addEventListener("click", () => {
      actorPickerOpen = !actorPickerOpen;
      render();
    });
    content.querySelectorAll("[data-ae-actors-action]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedActorIds = button.dataset.aeActorsAction === "all" ? null : new Set();
        actorPickerOpen = true;
        render();
      });
    });
    content.querySelectorAll("[data-ae-actor-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const allIds = (data?.actorBreakdown?.actors || []).map((actor) => actor.id);
        if (selectedActorIds === null) selectedActorIds = new Set(allIds);
        if (checkbox.checked) selectedActorIds.add(checkbox.dataset.aeActorId);
        else selectedActorIds.delete(checkbox.dataset.aeActorId);
        if (selectedActorIds.size === allIds.length) selectedActorIds = null;
        actorPickerOpen = true;
        render();
      });
    });
    content.querySelector("#ae-actor-search")?.addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      content.querySelectorAll("[data-ae-actor-label]").forEach((label) => {
        label.hidden = Boolean(query) && !label.dataset.aeActorLabel.includes(query);
      });
    });
    const activateView = (view) => {
      activeView = view;
      if (activeView === "quality") {
          const needsQuality = (data?.actorBreakdown?.actors || []).some((actor) => !actorQuality[actor.id]);
          if (needsQuality) window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_QUALITY", month: data?.month }, window.location.origin);
      }
      if (activeView === "acquisition") {
          const needsMarketing = (data?.actorBreakdown?.actors || []).some((actor) => !data?.actorMarketing?.[actor.id]);
          if (needsMarketing) window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_MARKETING", month: data?.month }, window.location.origin);
      }
      render();
    };
    content.querySelectorAll("[data-ae-view]").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.aeView));
    });
    content.querySelectorAll("[data-ae-go-to]").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.aeGoTo));
    });
    content.querySelector("[data-ae-quality-refresh]")?.addEventListener("click", () => {
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_QUALITY", month: data?.month }, window.location.origin);
    });
    content.querySelectorAll("[data-ae-quality-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const actorId = button.dataset.aeQualityToggle;
        if (expandedQualityActorIds.has(actorId)) expandedQualityActorIds.delete(actorId);
        else expandedQualityActorIds.add(actorId);
        render();
      });
    });
    content.querySelector("[data-ae-marketing-refresh]")?.addEventListener("click", () => {
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_ACTOR_MARKETING", month: data?.month }, window.location.origin);
    });
    content.querySelectorAll("[data-ae-marketing-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const actorId = button.dataset.aeMarketingToggle;
        if (expandedMarketingActorIds.has(actorId)) expandedMarketingActorIds.delete(actorId);
        else expandedMarketingActorIds.add(actorId);
        render();
      });
    });
    content.querySelectorAll("[data-ae-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        dailyMetric = button.dataset.aeMetric;
        render();
      });
    });
    content.querySelectorAll("[data-ae-health]").forEach((button) => {
      button.addEventListener("click", () => {
        healthMetric = button.dataset.aeHealth;
        render();
      });
    });
    content.querySelectorAll("[data-ae-run-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        runMetric = button.dataset.aeRunMetric;
        render();
      });
    });
    content.querySelectorAll("[data-ae-user-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        userMetric = button.dataset.aeUserMetric;
        render();
      });
    });
    content.querySelectorAll("[data-ae-bar-tooltip]").forEach((hitArea) => {
      let payload;
      try {
        payload = JSON.parse(hitArea.dataset.aeBarTooltip);
      } catch {
        return;
      }
      hitArea.addEventListener("mouseenter", (event) => showBarTooltip(event, payload, barTooltip));
      hitArea.addEventListener("mousemove", (event) => positionBarTooltip(event, barTooltip));
      hitArea.addEventListener("mouseleave", () => { barTooltip.hidden = true; });
    });
    content.querySelectorAll("[data-ae-pulse-tooltip]").forEach((hitArea) => {
      let payload;
      try {
        payload = JSON.parse(hitArea.dataset.aePulseTooltip);
      } catch {
        return;
      }
      hitArea.addEventListener("mouseenter", (event) => showPulseTooltip(event, payload, barTooltip));
      hitArea.addEventListener("mousemove", (event) => positionBarTooltip(event, barTooltip));
      hitArea.addEventListener("mouseleave", () => { barTooltip.hidden = true; });
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data?.type === "PROFIT_MARGIN_DATA") {
      const monthData = normalizePayload(event.data.payload, event.data.month);
      if (monthData && !event.data.background) {
        const comparisonKey = offsetMonth(monthData.month, -1);
        if (monthLoadStatus[comparisonKey]?.status === "error") delete monthLoadStatus[comparisonKey];
      }
      if (monthData) void saveProfitMonth(monthData, { background: Boolean(event.data.background) });
    } else if (event.data?.type === "ACTOR_BREAKDOWN_DATA") {
      const breakdown = normalizeActorBreakdown(event.data.payload, event.data.month);
      if (breakdown) void saveActorBreakdown(breakdown, { background: Boolean(event.data.background) });
    } else if (event.data?.type === "ACTOR_DAILY_DATA") {
      const daily = normalizeActorDaily(event.data.payload);
      if (daily) void saveActorDaily(event.data.month, event.data.actorId, daily);
    } else if (event.data?.type === "ACTOR_DAILY_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        dailyLoadStatus[key] = {
          status: event.data.status,
          completed: number(event.data.completed),
          total: number(event.data.total),
          message: String(event.data.message || ""),
        };
        render();
      }
    } else if (event.data?.type === "ACTOR_RUN_DAILY_DATA") {
      const daily = normalizeActorRunDaily(event.data.payload);
      if (daily) void saveActorRunDaily(event.data.month, event.data.actorId, daily);
    } else if (event.data?.type === "ACTOR_RUN_DAILY_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        runLoadStatus[key] = {
          status: event.data.status,
          completed: number(event.data.completed),
          total: number(event.data.total),
          message: String(event.data.message || ""),
        };
        render();
      }
    } else if (event.data?.type === "ACTOR_USER_DAILY_DATA") {
      const daily = normalizeActorUserDaily(event.data.payload);
      if (daily) void saveActorUserDaily(event.data.month, event.data.actorId, daily);
    } else if (event.data?.type === "ACTOR_USER_DAILY_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        userLoadStatus[key] = {
          status: event.data.status,
          completed: number(event.data.completed),
          total: number(event.data.total),
          message: String(event.data.message || ""),
        };
        render();
      }
    } else if (event.data?.type === "ACTOR_QUALITY_DATA") {
      const quality = normalizeActorQuality(event.data.payload, event.data.actorId);
      if (quality) void saveActorQuality(quality);
    } else if (event.data?.type === "ACTOR_QUALITY_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        qualityLoadStatus[key] = {
          status: event.data.status,
          completed: number(event.data.completed),
          total: number(event.data.total),
          message: String(event.data.message || ""),
        };
        render();
      }
    } else if (event.data?.type === "ACTOR_MARKETING_DATA") {
      const marketing = normalizeActorMarketing(event.data.payload, event.data.actorId, event.data.error);
      if (marketing) void saveActorMarketing(event.data.month, event.data.actorId, marketing);
    } else if (event.data?.type === "ACTOR_MARKETING_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        marketingLoadStatus[key] = {
          status: event.data.status,
          completed: number(event.data.completed),
          total: number(event.data.total),
          failed: number(event.data.failed),
          message: String(event.data.message || ""),
        };
        render();
      }
    } else if (event.data?.type === "MONTH_LOAD_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        monthLoadStatus[key] = {
          status: event.data.status,
          message: String(event.data.message || ""),
        };
        const isComparison = event.data.purpose === "comparison" || comparisonMonthRequest?.target === key;
        if (isComparison && (event.data.status === "complete" || event.data.status === "error")) {
          const returnTo = comparisonMonthRequest?.returnTo;
          if (returnTo && months[returnTo]) selectedMonth = returnTo;
          comparisonMonthRequest = null;
        } else if (event.data.status === "complete") {
          selectedMonth = key;
          pendingMonth = null;
        }
        render();
      }
    }
  });

  chrome.storage.local.get([STORAGE_KEY, QUALITY_STORAGE_KEY]).then((result) => {
    months = result[STORAGE_KEY] && typeof result[STORAGE_KEY] === "object"
      ? result[STORAGE_KEY]
      : {};
    actorQuality = result[QUALITY_STORAGE_KEY] && typeof result[QUALITY_STORAGE_KEY] === "object"
      ? result[QUALITY_STORAGE_KEY]
      : {};
    render();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }

  if (typeof MutationObserver !== "undefined") {
    let pinUpdateScheduled = false;
    const observer = new MutationObserver(() => {
      if (pinUpdateScheduled) return;
      pinUpdateScheduled = true;
      window.requestAnimationFrame(() => {
        pinUpdateScheduled = false;
        syncApifyTheme();
        ensurePinnedLauncher();
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
      childList: true,
      subtree: true,
    });
  }
})();
