(() => {
  "use strict";

  const MESSAGE_SOURCE = "apify-earnings-dashboard";
  const STORAGE_KEY = "apifyEarningsMonths";
  const UI_ID = "apify-earnings-extension-root";
  let months = {};
  let selectedMonth = null;
  let panelOpen = false;
  let activeView = "overview";
  let dailyMetric = "revenueUsd";
  let healthMetric = "problemRuns";
  let runMetric = "FAILED";
  let userMetric = "payingUsers";
  let selectedActorIds = null;
  let actorPickerOpen = false;
  let pendingMonth = null;
  const dailyLoadStatus = {};
  const runLoadStatus = {};
  const userLoadStatus = {};
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

  async function saveProfitMonth(monthData) {
    months[monthData.month] = { ...months[monthData.month], ...monthData };
    selectedMonth = monthData.month;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
    render();
  }

  async function saveActorBreakdown(breakdown) {
    months[breakdown.month] = {
      ...months[breakdown.month],
      month: breakdown.month,
      actorBreakdown: breakdown,
    };
    selectedMonth = breakdown.month;
    await chrome.storage.local.set({ [STORAGE_KEY]: months });
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

  function chartSvg(daily) {
    const width = 720;
    const height = 190;
    const revenue = daily.map((day) => day.revenueUsd);
    const profit = daily.map((day) => day.profitUsd);
    const all = [...revenue, ...profit, 0];
    const minValue = Math.min(...all);
    const maxValue = Math.max(...all);
    const zeroY = height - ((0 - minValue) / (maxValue - minValue || 1)) * height;
    const revenuePath = linePath(revenue, width, height, minValue, maxValue);
    const profitPath = linePath(profit, width, height, minValue, maxValue);
    const areaPath = `${revenuePath} L${width},${height} L0,${height} Z`;

    const guides = [0, 0.5, 1].map((ratio) => {
      const y = (height * ratio).toFixed(1);
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" class="ae-guide" />`;
    }).join("");

    const points = daily.map((day, index) => {
      const x = daily.length === 1 ? width / 2 : (index / (daily.length - 1)) * width;
      const range = maxValue - minValue || 1;
      const revenueY = height - ((day.revenueUsd - minValue) / range) * height;
      return `<circle cx="${x.toFixed(1)}" cy="${revenueY.toFixed(1)}" r="7" class="ae-hit">
        <title>${escapeHtml(day.date)} — Revenue ${escapeHtml(money(day.revenueUsd))}, Profit ${escapeHtml(money(day.profitUsd))}</title>
      </circle>`;
    }).join("");

    return `<svg class="ae-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily revenue and profit chart">
      <defs>
        <linearGradient id="ae-revenue-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7c5cff" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#7c5cff" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${guides}
      <line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" class="ae-zero" />
      <path d="${areaPath}" fill="url(#ae-revenue-fill)" />
      <path d="${revenuePath}" class="ae-line ae-line-revenue" />
      <path d="${profitPath}" class="ae-line ae-line-profit" />
      ${points}
    </svg>`;
  }

  const actorColors = [
    "#7c5cff", "#37d996", "#ff9f43", "#35b8ff", "#ff647c", "#e2c65a",
    "#b277ff", "#42d6c9", "#ff7eb6", "#7196ff", "#8ed45f", "#d889ff",
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

    return `<div class="ae-daily-chart-wrap">
      <svg class="ae-stacked-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily revenue contribution by Actor">${guides}${bars}</svg>
      <div class="ae-stack-axis-title">Day of month</div>
      <div class="ae-actor-legend">${legend}</div>
    </div>`;
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

    return `<div class="ae-daily-mix">
      <section class="ae-daily-stack-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Daily contribution by Actor</span><small>Stacked month-to-date values · hover a segment for details</small></div>
          <div class="ae-metric-toggle">
            <button type="button" data-ae-metric="revenueUsd" class="${dailyMetric === "revenueUsd" ? "ae-active" : ""}">Revenue</button>
            <button type="button" data-ae-metric="profitUsd" class="${dailyMetric === "profitUsd" ? "ae-active" : ""}">Profit</button>
            <button type="button" data-ae-metric="costUsd" class="${dailyMetric === "costUsd" ? "ae-active" : ""}">Cost</button>
          </div>
        </div>
        ${chart}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${captured} of ${total} Actors</span></div>` : ""}
      </section>
      <div class="ae-chart-note">The tallest bars are your strongest days. Each color is one Actor; small contributors beyond the top 11 are grouped as Other.</div>
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
          <div><span>Daily Actor operations</span><small>Stacked by Actor · select a run metric</small></div>
          <div class="ae-run-metric-toggle">
            ${Object.entries(runMetricLabels).map(([key, label]) => `<button type="button" data-ae-run-metric="${escapeHtml(key)}" class="${runMetric === key ? "ae-active" : ""}">${escapeHtml(label)}</button>`).join("")}
          </div>
        </div>
        <div class="ae-run-summary">
          <article><span>${escapeHtml(runMetricLabels[runMetric])}</span><strong>${integer(totalValue)}</strong><small>Across loaded Actors</small></article>
          <article><span>Actors with activity</span><strong>${integer(chart?.series.length || 0)}</strong><small>For this metric</small></article>
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
    const allSeries = Object.entries(actorUserDaily).filter(([id]) => actorSelected(id)).map(([id, daily]) => ({
      id,
      name: actorInfo.get(id)?.title || actorInfo.get(id)?.name || id,
      daily,
      total: daily.reduce((sum, day) => sum + number(day[userMetric]), 0),
    }));
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
    const selectedUserSeries = Object.entries(data?.actorUserDaily || {}).filter(([id]) => actorSelected(id));
    const payingTotal = selectedUserSeries.reduce((sum, [, daily]) => sum + daily.reduce((inner, day) => inner + day.payingUsers, 0), 0);
    const freeTotal = selectedUserSeries.reduce((sum, [, daily]) => sum + daily.reduce((inner, day) => inner + day.freeUsers, 0), 0);
    const payingShare = payingTotal + freeTotal ? payingTotal / (payingTotal + freeTotal) : 0;
    const totalValue = chart?.series.reduce((sum, item) => sum + item.total, 0) || 0;
    const peakIndex = chart ? chart.totalsByDate.indexOf(Math.max(...chart.totalsByDate)) : -1;
    const peakDate = peakIndex >= 0 ? chart.dates[peakIndex] : null;
    const peakValue = peakIndex >= 0 ? chart.totalsByDate[peakIndex] : 0;
    const unsupported = status?.status === "unsupported";

    return `<div class="ae-daily-users">
      <section class="ae-daily-stack-card">
        <div class="ae-card-heading ae-section-heading ae-run-heading">
          <div><span>Daily users by Actor</span><small>Actor-user occurrences · the same person may appear under multiple Actors</small></div>
          <div class="ae-user-metric-toggle">
            ${Object.entries(userMetricLabels).map(([key, label]) => `<button type="button" data-ae-user-metric="${key}" class="${userMetric === key ? "ae-active" : ""}">${escapeHtml(label)}</button>`).join("")}
          </div>
        </div>
        <div class="ae-run-summary">
          <article><span>${escapeHtml(userMetricLabels[userMetric])}</span><strong>${integer(totalValue)}</strong><small>Actor-user occurrences</small></article>
          <article><span>Paying share</span><strong>${percent(payingShare)}</strong><small>Paying ÷ free and paying</small></article>
          <article><span>Peak day</span><strong>${integer(peakValue)}</strong><small>${escapeHtml(peakDate || "No activity")}</small></article>
        </div>
        ${chart ? chart.html : `<div class="ae-run-empty"><strong>${unsupported ? "Daily user statistics unavailable" : status?.status === "waiting-request" ? "Waiting for Apify analytics" : `No ${escapeHtml(userMetricLabels[userMetric].toLowerCase())} recorded`}</strong><span>${unsupported ? escapeHtml(status?.message || "The endpoint request failed.") : status?.status === "loading" ? "Actor data is still loading." : "Choose another user metric to inspect."}</span></div>`}
        ${status?.status === "loading" ? `<div class="ae-load-progress"><i style="width:${progress.toFixed(1)}%"></i><span>Loaded ${captured} of ${totalActors} Actors</span></div>` : ""}
      </section>
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
      <div class="ae-actor-summary">
        <article><span>Actor profit</span><strong>${money(totals.profit)}</strong><small class="${profitChange !== null && profitChange >= 0 ? "ae-up" : "ae-down"}">${profitChange === null ? "No comparison" : `${profitChange >= 0 ? "↑" : "↓"} ${Math.abs(profitChange * 100).toFixed(1)}% vs previous`}</small></article>
        <article><span>Actor revenue</span><strong>${money(totals.revenue)}</strong><small>${actors.length} actors</small></article>
        <article><span>Paying users</span><strong>${integer(totals.users)}</strong><small>Sum across actors</small></article>
        <article><span>Total runs</span><strong>${integer(totals.runs)}</strong><small>For captured month</small></article>
      </div>
      <section class="ae-portfolio-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Revenue composition</span><small>Top Actors, month to date</small></div>
          <div class="ae-legend"><i class="ae-green"></i>Net profit <i class="ae-orange"></i>Cost</div>
        </div>
        <div class="ae-portfolio-list">${portfolioBars || '<div class="ae-inline-empty">No revenue reported for this month.</div>'}</div>
        <div class="ae-chart-note">Each full bar is an Actor’s revenue. Profit and cost are stacked inside it, so profit + cost = revenue.</div>
      </section>
      <section class="ae-health-card">
        <div class="ae-card-heading ae-section-heading">
          <div><span>Run health</span><small>Monthly totals · ranked by ${healthLabels[healthMetric]}</small></div>
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
          <div><span>Profit by actor</span><small>Ranked by net profit</small></div>
          <small>Revenue, usage and reliability</small>
        </div>
        <div class="ae-actor-list">${rows}</div>
      </section>
      <footer>Actor breakdown captured locally ${new Date(breakdown.capturedAt).toLocaleString()}</footer>
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
          <div class="ae-eyebrow">Earnings overview</div>
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
        <button type="button" data-ae-view="daily" class="${activeView === "daily" ? "ae-active" : ""}">Daily mix <span>${Object.keys(data.actorDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="runs" class="${activeView === "runs" ? "ae-active" : ""}">Daily runs <span>${Object.keys(data.actorRunDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="users" class="${activeView === "users" ? "ae-active" : ""}">Daily users <span>${Object.keys(data.actorUserDaily || {}).length || ""}</span></button>
        <button type="button" data-ae-view="actors" class="${activeView === "actors" ? "ae-active" : ""}">Actors <span>${pickedCount || ""}</span></button>
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
      </div>`;
    }

    const previousKey = Object.keys(months).sort().filter((key) => key < data.month).at(-1);
    const previous = previousKey ? overviewForSelection(months[previousKey]) : null;
    const revenueChange = previous?.total ? change(previous.total.revenueUsd, overviewData.total.revenueUsd) : null;
    const profitChange = previous?.total ? change(previous.total.profitUsd, overviewData.total.profitUsd) : null;
    const bestDay = overviewData.daily.reduce((best, day) => day.profitUsd > best.profitUsd ? day : best, overviewData.daily[0]);
    const latestDay = overviewData.daily.at(-1);
    const avgRevenue = overviewData.total.revenueUsd / overviewData.daily.length;
    const trend = (value) => value === null
      ? `<span class="ae-muted">No previous month</span>`
      : `<span class="${value >= 0 ? "ae-up" : "ae-down"}">${value >= 0 ? "↑" : "↓"} ${Math.abs(value * 100).toFixed(1)}% vs previous</span>`;

    return `${shellStart}
      <div class="ae-view ${activeView === "overview" ? "ae-visible" : ""}" data-ae-section="overview">
      <div class="ae-kpis">
        <article class="ae-kpi ae-kpi-primary">
          <span>Revenue</span><strong>${money(overviewData.total.revenueUsd)}</strong>${trend(revenueChange)}
        </article>
        <article class="ae-kpi">
          <span>Net profit</span><strong>${money(overviewData.total.profitUsd)}</strong>${trend(profitChange)}
        </article>
        <article class="ae-kpi">
          <span>Costs</span><strong>${money(overviewData.total.costUsd)}</strong><small>Revenue minus profit</small>
        </article>
        <article class="ae-kpi">
          <span>Margin</span><strong>${percent(overviewData.total.margin)}</strong><small>${overviewData.daily.length} reported days</small>
        </article>
      </div>

      <section class="ae-chart-card">
        <div class="ae-card-heading">
          <div><span>Daily performance</span><small>Hover over the chart for exact values</small></div>
          <div class="ae-legend"><i class="ae-purple"></i>Revenue <i class="ae-green"></i>Profit</div>
        </div>
        ${chartSvg(overviewData.daily)}
        <div class="ae-axis-labels"><span>${escapeHtml(overviewData.daily[0].date)}</span><span>${escapeHtml(latestDay.date)}</span></div>
      </section>

      <div class="ae-insights">
        <article><span>Best profit day</span><strong>${money(bestDay.profitUsd)}</strong><small>${escapeHtml(bestDay.date)}</small></article>
        <article><span>Average daily revenue</span><strong>${money(avgRevenue)}</strong><small>Across reported days</small></article>
        <article><span>Latest day</span><strong>${money(latestDay.revenueUsd)}</strong><small>${escapeHtml(latestDay.date)} revenue</small></article>
      </div>

      <footer>Captured locally ${new Date(overviewData.capturedAt).toLocaleString()}</footer>
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
    </div>`;
  }

  function ensureUi() {
    let root = document.getElementById(UI_ID);
    if (root) return root;
    if (!document.documentElement) return null;

    root = document.createElement("div");
    root.id = UI_ID;
    root.innerHTML = `<button id="ae-launcher" type="button" aria-label="Open Apify earnings dashboard">
        <span class="ae-launcher-icon">↗</span><span id="ae-launcher-label">Earnings</span>
      </button>
      <div id="ae-backdrop"></div>
      <aside id="ae-panel" aria-label="Apify earnings dashboard" aria-hidden="true">
        <header class="ae-panel-header">
          <div class="ae-brand"><div class="ae-logo">A</div><div><strong>Apify Earnings</strong><span>Local dashboard</span></div></div>
          <button id="ae-close" type="button" aria-label="Close dashboard">×</button>
        </header>
        <main id="ae-panel-content"></main>
      </aside>
      <div id="ae-bar-tooltip" role="tooltip" hidden></div>`;
    document.documentElement.appendChild(root);

    root.querySelector("#ae-launcher").addEventListener("click", () => setPanel(true));
    root.querySelector("#ae-close").addEventListener("click", () => setPanel(false));
    root.querySelector("#ae-backdrop").addEventListener("click", () => setPanel(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panelOpen) setPanel(false);
    });
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

  function render() {
    const root = ensureUi();
    if (!root) return;
    const keys = Object.keys(months).sort();
    if (!selectedMonth || !months[selectedMonth]) selectedMonth = keys.at(-1) || null;
    const data = selectedMonth ? months[selectedMonth] : null;
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
      pendingMonth = key;
      if (months[key]) selectedMonth = key;
      window.postMessage({ source: MESSAGE_SOURCE, type: "REQUEST_MONTH", month: `${key}-01` }, window.location.origin);
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
    content.querySelectorAll("[data-ae-view]").forEach((button) => {
      button.addEventListener("click", () => {
        activeView = button.dataset.aeView;
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
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data?.type === "PROFIT_MARGIN_DATA") {
      const monthData = normalizePayload(event.data.payload, event.data.month);
      if (monthData) void saveProfitMonth(monthData);
    } else if (event.data?.type === "ACTOR_BREAKDOWN_DATA") {
      const breakdown = normalizeActorBreakdown(event.data.payload, event.data.month);
      if (breakdown) void saveActorBreakdown(breakdown);
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
    } else if (event.data?.type === "MONTH_LOAD_STATUS") {
      const key = String(event.data.month || "").slice(0, 7);
      if (key) {
        monthLoadStatus[key] = {
          status: event.data.status,
          message: String(event.data.message || ""),
        };
        if (event.data.status === "complete") {
          selectedMonth = key;
          pendingMonth = null;
        }
        render();
      }
    }
  });

  chrome.storage.local.get(STORAGE_KEY).then((result) => {
    months = result[STORAGE_KEY] && typeof result[STORAGE_KEY] === "object"
      ? result[STORAGE_KEY]
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
        ensurePinnedLauncher();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
