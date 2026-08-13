(function () {
  const cf = window.cfpanel;
  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const state = {
    zones: [], bulkRecords: [], bulkSelected: new Set(), zoneSettings: [], universalSsl: null,
    workers: [], workerRoutes: [], rulesets: [], privateRoutes: [], gatewayLists: [], tunnels: [],
    accessApps: [], accessPolicies: [], selectedAccessAppId: "", previousSecurityLevel: ""
  };

  function unwrap(result) {
    if (!result?.ok) throw new Error(result?.error?.message || "Action failed");
    return result.data;
  }

  async function plus(action, ...args) {
    return unwrap(await cf.plus(action, ...args));
  }

  function notify(message, bad = false) {
    const box = el("toast");
    if (!box) return;
    box.textContent = message;
    box.classList.toggle("error", bad);
    box.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { box.hidden = true; }, 4500);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  function formatBytes(value) {
    let bytes = Number(value || 0);
    const units = ["B", "KB", "MB", "GB", "TB"];
    let index = 0;
    while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1; }
    return `${bytes.toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  function parseJson(text, fallback = {}) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return fallback;
    try { return JSON.parse(trimmed); }
    catch { throw new Error("Invalid JSON."); }
  }

  function modal({ title, body, submitText = "Save", onSubmit }) {
    const dialog = el("modal");
    const form = el("modalForm");
    el("modalTitle").textContent = title;
    el("modalBody").innerHTML = body;
    el("modalSubmit").style.display = "";
    el("modalSubmit").textContent = submitText;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = el("modalSubmit");
      try {
        button.disabled = true;
        await onSubmit(new FormData(form));
        dialog.close();
      } catch (error) {
        notify(error.message, true);
      } finally {
        button.disabled = false;
      }
    };
    dialog.showModal();
  }

  const pageMeta = {
    bulkdns: ["Bulk DNS", "Update selected DNS records across one or many Cloudflare zones."],
    analytics: ["Analytics", "Traffic and security analytics from Cloudflare GraphQL."],
    controls: ["Zone Controls", "Quick actions, SSL, cache and editable zone settings."],
    workers: ["Workers", "Create, update, remove and route Cloudflare Workers."],
    rules: ["Rules & Cache", "Inspect and manage Cloudflare Ruleset Engine resources."],
    zthub: ["Zero Trust Hub", "Private routes, Gateway resources and Zero Trust administration."],
    access: ["Access", "Manage Cloudflare Access applications and policies."],
    explorer: ["API Explorer", "Use Cloudflare v4 APIs directly through CFPanel's secure main process."]
  };

  function navigate(page) {
    document.querySelectorAll(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
    document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.plusPage === page));
    const meta = pageMeta[page];
    if (meta) {
      el("pageTitle").textContent = meta[0];
      el("pageSubtitle").textContent = meta[1];
    }
    loadPage(page).catch((error) => notify(error.message, true));
  }

  async function loadZones(force = false) {
    if (!state.zones.length || force) state.zones = unwrap(await cf.listZones());
    const options = state.zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join("");
    ["analyticsZoneSelect", "controlsZoneSelect", "workerRouteZoneSelect", "rulesZoneSelect"].forEach((id) => {
      const select = el(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = `<option value="">Select a domain</option>${options}`;
      if (state.zones.some((zone) => zone.id === current)) select.value = current;
    });
    const bulk = el("bulkZoneSelect");
    if (bulk) {
      const current = bulk.value;
      bulk.innerHTML = `<option value="">Choose scope</option><option value="__all__">All domains</option>${options}`;
      if (current === "__all__" || state.zones.some((zone) => zone.id === current)) bulk.value = current;
    }
    return state.zones;
  }

  async function loadPage(page) {
    await loadZones();
    if (page === "bulkdns" && el("bulkZoneSelect").value) await loadBulkDns();
    if (page === "workers") await loadWorkers();
    if (page === "zthub") await loadZeroTrustHub();
    if (page === "access") await loadAccess();
  }

  function bulkKey(record) { return `${record.__zoneId}:${record.id}`; }

  function visibleBulkRecords() {
    const filter = String(el("bulkFilter")?.value || "").trim().toLowerCase();
    if (!filter) return state.bulkRecords;
    return state.bulkRecords.filter((record) => [record.__zoneName, record.type, record.name, record.content, JSON.stringify(record.data || {})]
      .some((value) => String(value || "").toLowerCase().includes(filter)));
  }

  function renderBulkDns() {
    const rows = visibleBulkRecords();
    el("bulkSelectedCount").textContent = `${state.bulkSelected.size} selected`;
    el("bulkDnsCaption").textContent = state.bulkRecords.length
      ? `${state.bulkRecords.length} records loaded; ${rows.length} visible.`
      : "Select a zone or all zones, then load DNS records.";
    if (!rows.length) {
      el("bulkDnsTable").innerHTML = '<tr><td colspan="7" class="muted center">No matching DNS records.</td></tr>';
      return;
    }
    el("bulkDnsTable").innerHTML = rows.map((record) => {
      const key = bulkKey(record);
      const displayContent = record.content || (record.data ? JSON.stringify(record.data) : "");
      return `<tr><td><input class="record-check" type="checkbox" data-bulk-record="${esc(key)}" ${state.bulkSelected.has(key) ? "checked" : ""}></td><td>${esc(record.__zoneName)}</td><td><span class="badge">${esc(record.type)}</span></td><td>${esc(record.name)}</td><td class="content-cell" title="${esc(displayContent)}">${esc(displayContent)}</td><td>${record.proxied === true ? "Proxied" : record.proxied === false ? "DNS only" : "—"}</td><td>${record.ttl === 1 ? "Auto" : esc(record.ttl)}</td></tr>`;
    }).join("");
  }

  async function loadBulkDns() {
    await loadZones();
    const scope = el("bulkZoneSelect").value;
    if (!scope) return;
    state.bulkSelected.clear();
    const zones = scope === "__all__" ? state.zones : state.zones.filter((zone) => zone.id === scope);
    const results = await Promise.allSettled(zones.map(async (zone) => {
      const records = unwrap(await cf.listDns(zone.id));
      return records.map((record) => ({ ...record, __zoneId: zone.id, __zoneName: zone.name }));
    }));
    state.bulkRecords = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const failures = results.filter((result) => result.status === "rejected").length;
    renderBulkDns();
    if (failures) notify(`${failures} zone(s) could not be loaded with this API token.`, true);
  }

  async function applyBulkDns() {
    const selected = state.bulkRecords.filter((record) => state.bulkSelected.has(bulkKey(record)));
    if (!selected.length) throw new Error("Select at least one DNS record.");
    const content = el("bulkContent").value.trim();
    const proxy = el("bulkProxy").value;
    const ttlText = el("bulkTtl").value.trim();
    const advanced = parseJson(el("bulkPatchJson").value, {});
    const groups = new Map();
    for (const record of selected) {
      const patch = { id: record.id, ...advanced };
      if (content) patch.content = content;
      if (ttlText) patch.ttl = Number(ttlText);
      if (proxy !== "keep" && record.proxiable !== false) patch.proxied = proxy === "on";
      if (Object.keys(patch).length === 1) throw new Error("Choose at least one field to update.");
      if (!groups.has(record.__zoneId)) groups.set(record.__zoneId, []);
      groups.get(record.__zoneId).push(patch);
    }
    await Promise.all([...groups.entries()].map(([zoneId, patches]) => plus("batchDns", zoneId, { patches })));
    notify(`Updated ${selected.length} DNS record(s) across ${groups.size} zone(s).`);
    await loadBulkDns();
  }

  async function deleteBulkDns() {
    const selected = state.bulkRecords.filter((record) => state.bulkSelected.has(bulkKey(record)));
    if (!selected.length) throw new Error("Select at least one DNS record.");
    if (!confirm(`Delete ${selected.length} selected DNS record(s)? This can cause downtime.`)) return;
    const groups = new Map();
    selected.forEach((record) => {
      if (!groups.has(record.__zoneId)) groups.set(record.__zoneId, []);
      groups.get(record.__zoneId).push({ id: record.id });
    });
    await Promise.all([...groups.entries()].map(([zoneId, deletes]) => plus("batchDns", zoneId, { deletes })));
    notify(`Deleted ${selected.length} DNS record(s).`);
    await loadBulkDns();
  }

  async function loadAnalytics() {
    const zoneId = el("analyticsZoneSelect").value;
    if (!zoneId) throw new Error("Choose a domain.");
    const data = await plus("zoneAnalytics", zoneId, Number(el("analyticsHours").value));
    const traffic = Array.isArray(data?.zone?.traffic) ? data.zone.traffic : [];
    const firewall = Array.isArray(data?.zone?.firewall) ? data.zone.firewall : [];
    const requests = traffic.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const visits = traffic.reduce((sum, row) => sum + Number(row.sum?.visits || 0), 0);
    const bytes = traffic.reduce((sum, row) => sum + Number(row.sum?.edgeResponseBytes || 0), 0);
    const security = firewall.reduce((sum, row) => sum + Number(row.count || 0), 0);
    el("analyticsRequests").textContent = formatNumber(requests);
    el("analyticsVisits").textContent = formatNumber(visits);
    el("analyticsBytes").textContent = formatBytes(bytes);
    el("analyticsFirewall").textContent = formatNumber(security);
    el("analyticsTrafficTable").innerHTML = traffic.length ? traffic.map((row) => `<tr><td>${esc(row.dimensions?.datetimeHour || "—")}</td><td>${formatNumber(row.count)}</td><td>${formatNumber(row.sum?.visits)}</td><td>${formatBytes(row.sum?.edgeResponseBytes)}</td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No traffic data returned for this range.</td></tr>';
    el("analyticsFirewallList").className = firewall.length ? "stack" : "stack empty-state";
    el("analyticsFirewallList").innerHTML = firewall.length ? firewall.map((row) => `<div class="list-row"><strong>${esc(row.dimensions?.action || "unknown")}</strong><span class="badge">${formatNumber(row.count)}</span></div>`).join("") : "No security event groups returned.";
  }

  function setting(id) { return state.zoneSettings.find((item) => item.id === id); }

  function renderZoneControls() {
    const security = setting("security_level");
    const dev = setting("development_mode");
    const https = setting("always_use_https");
    el("underAttackState").textContent = security?.value === "under_attack" ? "ON" : String(security?.value || "—").toUpperCase();
    el("devModeState").textContent = String(dev?.value || "—").toUpperCase();
    el("httpsState").textContent = String(https?.value || "—").toUpperCase();
    el("universalSslState").textContent = state.universalSsl ? (state.universalSsl.enabled ? "ON" : "OFF") : "—";
    const editable = state.zoneSettings.filter((item) => item.editable !== false);
    el("zoneSettingsTable").innerHTML = editable.length ? editable.map((item) => `<tr><td><strong>${esc(item.id)}</strong></td><td><code class="service-code">${esc(typeof item.value === "string" ? item.value : JSON.stringify(item.value))}</code></td><td>${item.editable === false ? "No" : "Yes"}</td><td><button class="mini" data-setting-edit="${esc(item.id)}">Change</button></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No editable zone settings returned.</td></tr>';
  }

  async function loadZoneControls() {
    const zoneId = el("controlsZoneSelect").value;
    if (!zoneId) throw new Error("Choose a domain.");
    const [settings, ssl] = await Promise.all([plus("listZoneSettings", zoneId), plus("getUniversalSsl", zoneId).catch(() => null)]);
    state.zoneSettings = settings;
    state.universalSsl = ssl;
    renderZoneControls();
  }

  async function setQuickSetting(settingId, value) {
    const zoneId = el("controlsZoneSelect").value;
    if (!zoneId) throw new Error("Choose a domain.");
    await plus("updateZoneSetting", zoneId, settingId, value);
    await loadZoneControls();
  }

  function editZoneSetting(settingId) {
    const item = setting(settingId);
    if (!item) return;
    modal({
      title: `Change ${settingId}`,
      submitText: "Update setting",
      body: `<div class="modal-fields"><label><span>Value</span><textarea name="settingValue" rows="5">${esc(JSON.stringify(item.value, null, 2))}</textarea></label><p class="muted">Use valid JSON for numbers, booleans, arrays or objects. Plain text is accepted for string settings.</p></div>`,
      onSubmit: async (data) => {
        const raw = String(data.get("settingValue") || "").trim();
        let value;
        try { value = JSON.parse(raw); } catch { value = raw.replace(/^"|"$/g, ""); }
        await setQuickSetting(settingId, value);
        notify(`${settingId} updated.`);
      }
    });
  }

  async function purgeUrls() {
    const zoneId = el("controlsZoneSelect").value;
    if (!zoneId) throw new Error("Choose a domain.");
    const files = el("purgeUrls").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!files.length) throw new Error("Enter at least one URL.");
    await plus("purgeCache", zoneId, { files });
    notify(`Purged ${files.length} URL(s) from cache.`);
  }

  async function loadWorkers() {
    state.workers = await plus("listWorkers");
    el("workersTable").innerHTML = state.workers.length ? state.workers.map((worker) => `<tr><td><strong>${esc(worker.id)}</strong></td><td>${esc(worker.modified_on || worker.modified_on || "—")}</td><td>${esc(worker.compatibility_date || "—")}</td><td><div class="row-actions"><button class="mini" data-worker-edit="${esc(worker.id)}">Code</button><button class="mini danger" data-worker-delete="${esc(worker.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No Workers found.</td></tr>';
    await loadWorkerRoutes();
  }

  function workerEditor(workerName = "", code = "") {
    modal({
      title: workerName ? `Worker: ${workerName}` : "Create Worker",
      submitText: workerName ? "Upload code" : "Create Worker",
      body: `<div class="modal-fields"><label><span>Worker name</span><input name="workerName" required value="${esc(workerName)}" ${workerName ? "readonly" : ""}></label><label><span>Compatibility date</span><input name="compatibilityDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label><span>Module code</span><textarea class="code-editor" name="workerCode" rows="20" required>${esc(code)}</textarea></label><p class="muted">This editor uploads a single ES-module Worker. For Workers with complex assets or bindings, inspect them here but use the API Explorer or Wrangler for advanced multipart configuration.</p></div>`,
      onSubmit: async (data) => {
        await plus("uploadWorker", { scriptName: data.get("workerName"), code: data.get("workerCode"), compatibilityDate: data.get("compatibilityDate") });
        notify("Worker uploaded.");
        await loadWorkers();
      }
    });
  }

  async function loadWorkerRoutes() {
    const zoneId = el("workerRouteZoneSelect")?.value;
    if (!zoneId) {
      if (el("workerRoutesTable")) el("workerRoutesTable").innerHTML = '<tr><td colspan="3" class="muted center">Choose a zone.</td></tr>';
      return;
    }
    state.workerRoutes = await plus("listWorkerRoutes", zoneId);
    el("workerRoutesTable").innerHTML = state.workerRoutes.length ? state.workerRoutes.map((route) => `<tr><td>${esc(route.pattern)}</td><td>${esc(route.script || "No Worker")}</td><td><div class="row-actions"><button class="mini" data-worker-route-edit="${esc(route.id)}">Edit</button><button class="mini danger" data-worker-route-delete="${esc(route.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="3" class="muted center">No Worker routes.</td></tr>';
  }

  function workerRouteEditor(route = null) {
    const workers = state.workers.map((worker) => `<option value="${esc(worker.id)}" ${route?.script === worker.id ? "selected" : ""}>${esc(worker.id)}</option>`).join("");
    modal({
      title: route ? "Edit Worker route" : "Add Worker route",
      submitText: route ? "Update route" : "Create route",
      body: `<div class="modal-fields"><label><span>Pattern</span><input name="pattern" required value="${esc(route?.pattern || "")}" placeholder="example.com/*"></label><label><span>Worker</span><select name="script"><option value="">Disable Worker on pattern</option>${workers}</select></label></div>`,
      onSubmit: async (data) => {
        const zoneId = el("workerRouteZoneSelect").value;
        const payload = { pattern: data.get("pattern"), script: data.get("script") || undefined };
        if (route) await plus("updateWorkerRoute", zoneId, route.id, payload);
        else await plus("createWorkerRoute", zoneId, payload);
        notify(route ? "Worker route updated." : "Worker route created.");
        await loadWorkerRoutes();
      }
    });
  }

  async function loadRulesets() {
    const zoneId = el("rulesZoneSelect").value;
    if (!zoneId) return;
    state.rulesets = await plus("listRulesets", zoneId);
    el("rulesetsTable").innerHTML = state.rulesets.length ? state.rulesets.map((ruleset) => `<tr><td><strong>${esc(ruleset.name)}</strong></td><td>${esc(ruleset.phase)}</td><td>${esc(ruleset.kind)}</td><td><div class="row-actions"><button class="mini" data-ruleset-view="${esc(ruleset.id)}">View</button><button class="mini" data-ruleset-edit="${esc(ruleset.id)}">Edit JSON</button><button class="mini danger" data-ruleset-delete="${esc(ruleset.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No rulesets returned.</td></tr>';
  }

  async function showRuleset(id) {
    const zoneId = el("rulesZoneSelect").value;
    const ruleset = await plus("getRuleset", zoneId, id);
    el("rulesetOutput").textContent = JSON.stringify(ruleset, null, 2);
    return ruleset;
  }

  function rulesetEditor(ruleset = null) {
    const payload = ruleset ? {
      name: ruleset.name,
      description: ruleset.description || "",
      kind: ruleset.kind,
      phase: ruleset.phase,
      rules: ruleset.rules || []
    } : {
      name: "CFPanel ruleset",
      description: "Managed by CFPanel",
      kind: "zone",
      phase: "http_request_dynamic_redirect",
      rules: []
    };
    modal({
      title: ruleset ? "Edit ruleset JSON" : "Create ruleset JSON",
      submitText: ruleset ? "Update ruleset" : "Create ruleset",
      body: `<div class="modal-fields"><label><span>Ruleset JSON</span><textarea class="code-editor" name="rulesetJson" rows="20">${esc(JSON.stringify(payload, null, 2))}</textarea></label></div>`,
      onSubmit: async (data) => {
        const body = parseJson(data.get("rulesetJson"));
        const zoneId = el("rulesZoneSelect").value;
        if (ruleset) await plus("updateRuleset", zoneId, ruleset.id, body);
        else await plus("createRuleset", zoneId, body);
        notify(ruleset ? "Ruleset updated." : "Ruleset created.");
        await loadRulesets();
      }
    });
  }

  async function loadZeroTrustHub() {
    const [routes, lists, tunnels] = await Promise.all([plus("listPrivateRoutes"), plus("listGatewayLists"), cf.listTunnels().then(unwrap)]);
    state.privateRoutes = routes;
    state.gatewayLists = lists;
    state.tunnels = tunnels;
    el("privateRoutesTable").innerHTML = routes.length ? routes.map((route) => `<tr><td>${esc(route.network)}</td><td>${esc(state.tunnels.find((tunnel) => tunnel.id === route.tunnel_id)?.name || route.tunnel_id || "—")}</td><td>${esc(route.comment || "")}</td><td><div class="row-actions"><button class="mini" data-private-route-edit="${esc(route.id)}">Edit</button><button class="mini danger" data-private-route-delete="${esc(route.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No private network routes.</td></tr>';
    el("gatewayListsTable").innerHTML = lists.length ? lists.map((list) => `<tr><td>${esc(list.name || list.id)}</td><td>${esc(list.type || "—")}</td><td>${formatNumber(list.count ?? list.items?.length ?? 0)}</td><td><button class="mini danger" data-gateway-list-delete="${esc(list.id)}">Delete</button></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No Gateway lists.</td></tr>';
  }

  function privateRouteEditor(route = null) {
    const options = state.tunnels.map((tunnel) => `<option value="${esc(tunnel.id)}" ${route?.tunnel_id === tunnel.id ? "selected" : ""}>${esc(tunnel.name)} — ${esc(tunnel.id)}</option>`).join("");
    modal({
      title: route ? "Edit private route" : "Add private route",
      submitText: route ? "Update route" : "Create route",
      body: `<div class="modal-fields"><label><span>Network CIDR</span><input name="network" required value="${esc(route?.network || "")}" placeholder="10.0.0.0/24"></label><label><span>Tunnel</span><select name="tunnelId" required>${options}</select></label><label><span>Comment</span><input name="comment" value="${esc(route?.comment || "")}"></label></div>`,
      onSubmit: async (data) => {
        const payload = { network: data.get("network"), tunnel_id: data.get("tunnelId"), comment: data.get("comment") };
        if (route) await plus("updatePrivateRoute", route.id, payload);
        else await plus("createPrivateRoute", payload);
        notify(route ? "Private route updated." : "Private route created.");
        await loadZeroTrustHub();
      }
    });
  }

  function gatewayListEditor() {
    modal({
      title: "Create Gateway list",
      submitText: "Create list",
      body: `<div class="modal-fields"><label><span>Name</span><input name="listName" required></label><label><span>Type</span><select name="listType"><option>DOMAIN</option><option>IP</option><option>URL</option><option>EMAIL</option><option>DEVICE</option><option>LOCATION</option><option>AAGUID</option></select></label><label><span>Description</span><input name="description"></label><label><span>Items, one value per line</span><textarea name="items" rows="10"></textarea></label></div>`,
      onSubmit: async (data) => {
        const items = String(data.get("items") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map((value) => ({ value }));
        await plus("createGatewayList", { name: data.get("listName"), type: data.get("listType"), description: data.get("description"), items });
        notify("Gateway list created.");
        await loadZeroTrustHub();
      }
    });
  }

  async function loadAccess() {
    state.accessApps = await plus("listAccessApps");
    el("accessAppsTable").innerHTML = state.accessApps.length ? state.accessApps.map((app) => `<tr><td><strong>${esc(app.name || app.id)}</strong></td><td>${esc(app.domain || app.custom_deny_url || "—")}</td><td>${esc(app.type || "—")}</td><td><div class="row-actions"><button class="mini" data-access-policies="${esc(app.id)}">Policies</button><button class="mini" data-access-edit="${esc(app.id)}">Edit</button><button class="mini danger" data-access-delete="${esc(app.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="4" class="muted center">No Access applications.</td></tr>';
    if (state.selectedAccessAppId && state.accessApps.some((app) => app.id === state.selectedAccessAppId)) await loadAccessPolicies(state.selectedAccessAppId);
  }

  function accessAppEditor(app = null) {
    modal({
      title: app ? "Edit Access application" : "Create Access application",
      submitText: app ? "Update application" : "Create application",
      body: `<div class="modal-fields"><label><span>Name</span><input name="appName" required value="${esc(app?.name || "")}"></label><label><span>Domain</span><input name="domain" required value="${esc(app?.domain || "")}" placeholder="app.example.com"></label><label><span>Session duration</span><input name="sessionDuration" value="${esc(app?.session_duration || "24h")}"></label></div>`,
      onSubmit: async (data) => {
        const payload = {
          name: data.get("appName"), domain: data.get("domain"), session_duration: data.get("sessionDuration"), type: app?.type || "self_hosted"
        };
        if (app) await plus("updateAccessApp", app.id, payload);
        else await plus("createAccessApp", payload);
        notify(app ? "Access application updated." : "Access application created.");
        await loadAccess();
      }
    });
  }

  async function loadAccessPolicies(appId) {
    state.selectedAccessAppId = appId;
    state.accessPolicies = await plus("listAccessPolicies", appId);
    const app = state.accessApps.find((item) => item.id === appId);
    el("accessPolicyCaption").textContent = `Policies for ${app?.name || appId}`;
    el("newAccessPolicyBtn").disabled = false;
    el("accessPoliciesTable").innerHTML = state.accessPolicies.length ? state.accessPolicies.map((policy) => `<tr><td>${esc(policy.name || policy.id)}</td><td>${esc(policy.decision || "—")}</td><td><div class="row-actions"><button class="mini" data-access-policy-edit="${esc(policy.id)}">Edit JSON</button><button class="mini danger" data-access-policy-delete="${esc(policy.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="3" class="muted center">No policies on this application.</td></tr>';
  }

  function cleanPolicy(policy) {
    const copy = JSON.parse(JSON.stringify(policy || {}));
    ["id", "created_at", "updated_at", "reusable"].forEach((key) => delete copy[key]);
    return copy;
  }

  function accessPolicyEditor(policy = null) {
    const sample = policy ? cleanPolicy(policy) : { name: "Allow policy", decision: "allow", include: [], exclude: [], require: [] };
    modal({
      title: policy ? "Edit Access policy JSON" : "Create Access policy JSON",
      submitText: policy ? "Update policy" : "Create policy",
      body: `<div class="modal-fields"><label><span>Policy JSON</span><textarea class="code-editor" name="policyJson" rows="20">${esc(JSON.stringify(sample, null, 2))}</textarea></label><p class="muted">Configure include/exclude/require rules explicitly before saving. CFPanel does not auto-create an allow-everyone policy.</p></div>`,
      onSubmit: async (data) => {
        const payload = parseJson(data.get("policyJson"));
        if (policy) await plus("updateAccessPolicy", state.selectedAccessAppId, policy.id, payload);
        else await plus("createAccessPolicy", state.selectedAccessAppId, payload);
        notify(policy ? "Access policy updated." : "Access policy created.");
        await loadAccessPolicies(state.selectedAccessAppId);
      }
    });
  }

  async function sendApiRequest() {
    const method = el("apiMethod").value;
    let path = el("apiPath").value.trim();
    const settings = unwrap(await cf.getSettings());
    path = path.replaceAll("{account}", settings.accountId || "");
    if (!path) throw new Error("Enter a Cloudflare API path.");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !confirm(`Send ${method} ${path}?`)) return;
    const rawBody = el("apiBody").value.trim();
    const body = rawBody ? parseJson(rawBody) : undefined;
    el("apiOutput").textContent = "Loading…";
    try {
      const result = await plus("apiExplorer", { method, path, body });
      el("apiOutput").textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    } catch (error) {
      el("apiOutput").textContent = error.message;
      throw error;
    }
  }

  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-plus-page]");
    if (nav) return navigate(nav.dataset.plusPage);

    const settingEdit = event.target.closest("[data-setting-edit]");
    if (settingEdit) return editZoneSetting(settingEdit.dataset.settingEdit);

    const workerEdit = event.target.closest("[data-worker-edit]");
    if (workerEdit) {
      try { workerEditor(workerEdit.dataset.workerEdit, await plus("downloadWorker", workerEdit.dataset.workerEdit)); }
      catch (error) { notify(error.message, true); }
      return;
    }
    const workerDelete = event.target.closest("[data-worker-delete]");
    if (workerDelete && confirm(`Delete Worker ${workerDelete.dataset.workerDelete}?`)) {
      try { await plus("deleteWorker", workerDelete.dataset.workerDelete); notify("Worker deleted."); await loadWorkers(); } catch (error) { notify(error.message, true); }
      return;
    }
    const workerRouteEdit = event.target.closest("[data-worker-route-edit]");
    if (workerRouteEdit) return workerRouteEditor(state.workerRoutes.find((route) => route.id === workerRouteEdit.dataset.workerRouteEdit));
    const workerRouteDelete = event.target.closest("[data-worker-route-delete]");
    if (workerRouteDelete && confirm("Delete this Worker route?")) {
      try { await plus("deleteWorkerRoute", el("workerRouteZoneSelect").value, workerRouteDelete.dataset.workerRouteDelete); notify("Worker route deleted."); await loadWorkerRoutes(); } catch (error) { notify(error.message, true); }
      return;
    }

    const rulesetView = event.target.closest("[data-ruleset-view]");
    if (rulesetView) { try { await showRuleset(rulesetView.dataset.rulesetView); } catch (error) { notify(error.message, true); } return; }
    const rulesetEdit = event.target.closest("[data-ruleset-edit]");
    if (rulesetEdit) { try { rulesetEditor(await showRuleset(rulesetEdit.dataset.rulesetEdit)); } catch (error) { notify(error.message, true); } return; }
    const rulesetDelete = event.target.closest("[data-ruleset-delete]");
    if (rulesetDelete && confirm("Delete this ruleset? Managed rulesets may not be deletable.")) {
      try { await plus("deleteRuleset", el("rulesZoneSelect").value, rulesetDelete.dataset.rulesetDelete); notify("Ruleset deleted."); await loadRulesets(); } catch (error) { notify(error.message, true); }
      return;
    }

    const privateEdit = event.target.closest("[data-private-route-edit]");
    if (privateEdit) return privateRouteEditor(state.privateRoutes.find((route) => route.id === privateEdit.dataset.privateRouteEdit));
    const privateDelete = event.target.closest("[data-private-route-delete]");
    if (privateDelete && confirm("Delete this private network route?")) {
      try { await plus("deletePrivateRoute", privateDelete.dataset.privateRouteDelete); notify("Private route deleted."); await loadZeroTrustHub(); } catch (error) { notify(error.message, true); }
      return;
    }
    const gatewayDelete = event.target.closest("[data-gateway-list-delete]");
    if (gatewayDelete && confirm("Delete this Gateway list?")) {
      try { await plus("deleteGatewayList", gatewayDelete.dataset.gatewayListDelete); notify("Gateway list deleted."); await loadZeroTrustHub(); } catch (error) { notify(error.message, true); }
      return;
    }

    const accessPolicies = event.target.closest("[data-access-policies]");
    if (accessPolicies) { try { await loadAccessPolicies(accessPolicies.dataset.accessPolicies); } catch (error) { notify(error.message, true); } return; }
    const accessEdit = event.target.closest("[data-access-edit]");
    if (accessEdit) return accessAppEditor(state.accessApps.find((app) => app.id === accessEdit.dataset.accessEdit));
    const accessDelete = event.target.closest("[data-access-delete]");
    if (accessDelete && confirm("Delete this Access application?")) {
      try { await plus("deleteAccessApp", accessDelete.dataset.accessDelete); notify("Access application deleted."); state.selectedAccessAppId = ""; await loadAccess(); } catch (error) { notify(error.message, true); }
      return;
    }
    const policyEdit = event.target.closest("[data-access-policy-edit]");
    if (policyEdit) return accessPolicyEditor(state.accessPolicies.find((policy) => policy.id === policyEdit.dataset.accessPolicyEdit));
    const policyDelete = event.target.closest("[data-access-policy-delete]");
    if (policyDelete && confirm("Delete this Access policy?")) {
      try { await plus("deleteAccessPolicy", state.selectedAccessAppId, policyDelete.dataset.accessPolicyDelete); notify("Access policy deleted."); await loadAccessPolicies(state.selectedAccessAppId); } catch (error) { notify(error.message, true); }
      return;
    }

    const shortcut = event.target.closest("[data-api-shortcut]");
    if (shortcut) {
      navigate("explorer");
      el("apiMethod").value = "GET";
      el("apiPath").value = shortcut.dataset.apiShortcut;
      el("apiBody").value = "";
    }
  });

  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-bulk-record]");
    if (checkbox) {
      if (checkbox.checked) state.bulkSelected.add(checkbox.dataset.bulkRecord);
      else state.bulkSelected.delete(checkbox.dataset.bulkRecord);
      el("bulkSelectedCount").textContent = `${state.bulkSelected.size} selected`;
    }
  });

  el("bulkReloadBtn")?.addEventListener("click", () => loadBulkDns().catch((error) => notify(error.message, true)));
  el("bulkZoneSelect")?.addEventListener("change", () => loadBulkDns().catch((error) => notify(error.message, true)));
  el("bulkFilter")?.addEventListener("input", renderBulkDns);
  el("bulkSelectAllBtn")?.addEventListener("click", () => { visibleBulkRecords().forEach((record) => state.bulkSelected.add(bulkKey(record))); renderBulkDns(); });
  el("bulkSelectNoneBtn")?.addEventListener("click", () => { state.bulkSelected.clear(); renderBulkDns(); });
  el("bulkApplyBtn")?.addEventListener("click", () => applyBulkDns().catch((error) => notify(error.message, true)));
  el("bulkDeleteBtn")?.addEventListener("click", () => deleteBulkDns().catch((error) => notify(error.message, true)));

  el("analyticsLoadBtn")?.addEventListener("click", () => loadAnalytics().catch((error) => notify(error.message, true)));
  el("controlsLoadBtn")?.addEventListener("click", () => loadZoneControls().catch((error) => notify(error.message, true)));
  el("underAttackBtn")?.addEventListener("click", async () => {
    try {
      const current = setting("security_level")?.value;
      if (current !== "under_attack") state.previousSecurityLevel = current || "medium";
      await setQuickSetting("security_level", current === "under_attack" ? (state.previousSecurityLevel || "medium") : "under_attack");
      notify("Security level updated.");
    } catch (error) { notify(error.message, true); }
  });
  el("devModeBtn")?.addEventListener("click", () => setQuickSetting("development_mode", setting("development_mode")?.value === "on" ? "off" : "on").then(() => notify("Development Mode updated.")).catch((error) => notify(error.message, true)));
  el("httpsBtn")?.addEventListener("click", () => setQuickSetting("always_use_https", setting("always_use_https")?.value === "on" ? "off" : "on").then(() => notify("Always Use HTTPS updated.")).catch((error) => notify(error.message, true)));
  el("universalSslBtn")?.addEventListener("click", async () => {
    try {
      const zoneId = el("controlsZoneSelect").value;
      if (!zoneId) throw new Error("Choose a domain.");
      const next = !state.universalSsl?.enabled;
      if (!next && !confirm("Disable Universal SSL? HTTPS can stop working if the zone has no other edge certificate.")) return;
      await plus("setUniversalSsl", zoneId, next);
      notify("Universal SSL updated.");
      await loadZoneControls();
    } catch (error) { notify(error.message, true); }
  });
  el("purgeUrlsBtn")?.addEventListener("click", () => purgeUrls().catch((error) => notify(error.message, true)));
  el("purgeAllBtn")?.addEventListener("click", async () => {
    try {
      const zoneId = el("controlsZoneSelect").value;
      if (!zoneId) throw new Error("Choose a domain.");
      if (!confirm("Purge the entire Cloudflare cache for this zone?")) return;
      await plus("purgeCache", zoneId, { purge_everything: true });
      notify("Zone cache purged.");
    } catch (error) { notify(error.message, true); }
  });

  el("newWorkerBtn")?.addEventListener("click", () => workerEditor("", `export default {\n  async fetch(request, env, ctx) {\n    return new Response("Hello from CFPanel");\n  }\n};\n`));
  el("workersReloadBtn")?.addEventListener("click", () => loadWorkers().catch((error) => notify(error.message, true)));
  el("workerRouteZoneSelect")?.addEventListener("change", () => loadWorkerRoutes().catch((error) => notify(error.message, true)));
  el("newWorkerRouteBtn")?.addEventListener("click", () => workerRouteEditor());

  el("rulesLoadBtn")?.addEventListener("click", () => loadRulesets().catch((error) => notify(error.message, true)));
  el("newRulesetBtn")?.addEventListener("click", () => rulesetEditor());

  el("newPrivateRouteBtn")?.addEventListener("click", () => privateRouteEditor());
  el("newGatewayListBtn")?.addEventListener("click", gatewayListEditor);

  el("newAccessAppBtn")?.addEventListener("click", () => accessAppEditor());
  el("accessReloadBtn")?.addEventListener("click", () => loadAccess().catch((error) => notify(error.message, true)));
  el("newAccessPolicyBtn")?.addEventListener("click", () => accessPolicyEditor());

  el("apiSendBtn")?.addEventListener("click", () => sendApiRequest().catch((error) => notify(error.message, true)));
  el("refreshBtn")?.addEventListener("click", () => {
    const active = document.querySelector(".nav-item[data-plus-page].active")?.dataset.plusPage;
    if (active) loadPage(active).catch((error) => notify(error.message, true));
  });

  loadZones().catch(() => {});
})();
