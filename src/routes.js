(function () {
  const cf = window.cfpanel;
  const routeState = {
    tunnelId: "",
    zones: [],
    tunnels: [],
    config: null,
    search: "",
    page: 1,
    pageSize: 10,
    focusHostname: ""
  };
  const dnsUi = { zoneFilter: "", search: "", page: 1, pageSize: 15 };
  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const unwrap = (result) => {
    if (!result?.ok) throw new Error(result?.error?.message || "Action failed");
    return result.data;
  };

  function notify(message, bad = false) {
    const box = el("toast");
    if (!box) return;
    box.textContent = message;
    box.classList.toggle("error", bad);
    box.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { box.hidden = true; }, 4000);
  }

  function installStyles() {
    if (el("cfpanelUxStyles")) return;
    const style = document.createElement("style");
    style.id = "cfpanelUxStyles";
    style.textContent = `
      .nav-more{margin-top:4px;border-top:1px solid rgba(72,245,156,.08);padding-top:5px}
      .nav-more summary{list-style:none;cursor:pointer;padding:11px 12px;border-radius:10px;color:#a9c6b7;font-size:14px;user-select:none}
      .nav-more summary::-webkit-details-marker{display:none}.nav-more summary:hover{background:#0d1e16;color:#fff}
      .nav-more summary::after{content:'›';float:right;transition:transform .16s ease}.nav-more[open] summary::after{transform:rotate(90deg)}
      .nav-more-list{display:grid;gap:5px;padding:4px 0 8px 10px}.nav-more-list .nav-item{font-size:13px;padding:9px 10px}
      .toolbar.clean-toolbar{display:grid;grid-template-columns:minmax(220px,320px) minmax(260px,1fr) auto auto;align-items:center}
      .toolbar-search{position:relative}.toolbar-search input{padding-left:34px}.toolbar-search::before{content:'⌕';position:absolute;left:12px;top:9px;color:var(--muted);z-index:1}
      .toolbar-search small{display:block;margin-top:5px;color:var(--muted);font-size:11px}
      .dns-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dns-tools input{width:min(360px,48vw)}.dns-tools select{width:auto;min-width:110px}
      .pager{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 4px 0;color:var(--muted);font-size:12px}.pager-actions{display:flex;gap:7px}
      .tunnel-link{display:grid;gap:2px;text-align:left;width:100%;border:0;background:transparent;color:inherit;padding:0}.tunnel-link strong{color:var(--green);font-weight:700}.tunnel-link small{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tunnel-link:hover strong{text-decoration:underline}
      .tunnel-workspace{display:grid;grid-template-columns:330px minmax(0,1fr);gap:16px;align-items:start}.tunnel-workspace:not(.has-selection){grid-template-columns:1fr}.tunnel-workspace:not(.has-selection) .tunnel-node-list{grid-template-columns:repeat(auto-fill,minmax(280px,1fr));display:grid}.tunnel-node-list{display:grid;gap:9px}.tunnel-node{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;text-align:left;padding:14px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(180deg,var(--panel),#09160f);color:var(--text);transition:border-color .15s ease,background .15s ease,transform .15s ease}.tunnel-node:hover{border-color:#347757;background:#0d2117;transform:translateY(-1px)}.tunnel-node.selected{border-color:var(--green);box-shadow:0 0 0 1px rgba(72,245,156,.12)}.tunnel-node strong,.tunnel-node small{display:block}.tunnel-node small{margin-top:4px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tunnel-node-side{display:grid;justify-items:end;gap:7px}.tunnel-open{font-size:11px;color:var(--green)}
      .route-manager{margin-top:0;min-width:0}.route-manager-head{border-bottom:1px solid #173224;padding-bottom:15px}.route-manager .table-wrap{max-height:520px}.route-search-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.route-search-row input{max-width:300px}.route-pager{margin-top:10px}
      .route-host-focus{background:rgba(72,245,156,.06)}.route-host-focus td:first-child{box-shadow:inset 3px 0 0 var(--green)}
      .dashboard-click{width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:0}.dashboard-click:hover strong{color:var(--green)}
      .modal-actions [value='cancel'],.modal-head [value='cancel']{cursor:pointer}
      @media(max-width:1050px){.tunnel-workspace{grid-template-columns:1fr}.toolbar.clean-toolbar{grid-template-columns:1fr 1fr}.tunnel-node-list{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));display:grid}}
      @media(max-width:720px){.toolbar.clean-toolbar{grid-template-columns:1fr}.dns-tools{align-items:stretch}.dns-tools input{width:100%}.tunnel-node-list{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function installModalCloseFix() {
    const dialog = el("modal");
    if (!dialog) return;
    dialog.querySelectorAll('[value="cancel"]').forEach((button) => {
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dialog.close("cancel");
      });
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close("cancel");
    });
  }

  function installSimpleNavigation() {
    const navNode = el("nav");
    if (!navNode || navNode.querySelector(".nav-more")) return;
    const advanced = [...navNode.querySelectorAll("[data-plus-page]")];
    if (!advanced.length) return;
    const details = document.createElement("details");
    details.className = "nav-more";
    details.innerHTML = '<summary>More Cloudflare tools</summary><div class="nav-more-list"></div>';
    const list = details.querySelector(".nav-more-list");
    advanced.forEach((button) => list.appendChild(button));
    const settings = navNode.querySelector('[data-page="settings"]');
    navNode.insertBefore(details, settings || null);
    const observer = new MutationObserver(() => {
      if (list.querySelector(".nav-item.active")) details.open = true;
    });
    observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["class"] });
  }

  function installDnsTools() {
    const page = el("page-domains");
    if (!page || el("dnsSearch")) return;
    const toolbar = page.querySelector(":scope > .toolbar");
    if (toolbar) {
      toolbar.classList.add("clean-toolbar");
      const zoneSearchWrap = document.createElement("div");
      zoneSearchWrap.className = "toolbar-search";
      zoneSearchWrap.innerHTML = '<input id="zoneSearch" placeholder="Find a managed domain…" autocomplete="off"><small id="zoneSearchStatus">Search your Cloudflare zones</small>';
      toolbar.insertBefore(zoneSearchWrap, toolbar.firstChild);
    }

    const panel = page.querySelector("article.panel");
    const head = panel?.querySelector(".panel-head");
    if (head) {
      const tools = document.createElement("div");
      tools.className = "dns-tools";
      tools.innerHTML = '<div class="toolbar-search"><input id="dnsSearch" placeholder="Search DNS name, type, IP or target…"></div><select id="dnsPageSize"><option value="10">10 / page</option><option value="15" selected>15 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></select>';
      head.insertBefore(tools, head.lastElementChild);
    }

    const wrap = panel?.querySelector(".table-wrap");
    if (wrap) {
      const pager = document.createElement("div");
      pager.id = "dnsPager";
      pager.className = "pager";
      pager.innerHTML = '<span id="dnsPageInfo">Page 1</span><div class="pager-actions"><button class="mini" id="dnsPrevBtn" type="button">Previous</button><button class="mini" id="dnsNextBtn" type="button">Next</button></div>';
      wrap.insertAdjacentElement("afterend", pager);
    }

    el("zoneSearch")?.addEventListener("input", (event) => {
      dnsUi.zoneFilter = event.target.value.trim().toLowerCase();
      renderZones();
    });
    el("zoneSearch")?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      const matches = state.zones.filter((zone) => zone.name.toLowerCase().includes(dnsUi.zoneFilter));
      if (!matches.length) return;
      const exact = matches.find((zone) => zone.name.toLowerCase() === dnsUi.zoneFilter) || matches[0];
      state.selectedZoneId = exact.id;
      dnsUi.page = 1;
      renderZones();
      await loadDns(exact.id);
    });
    el("dnsSearch")?.addEventListener("input", (event) => {
      dnsUi.search = event.target.value.trim().toLowerCase();
      dnsUi.page = 1;
      renderDns();
    });
    el("dnsPageSize")?.addEventListener("change", (event) => {
      dnsUi.pageSize = Number(event.target.value) || 15;
      dnsUi.page = 1;
      renderDns();
    });
    el("dnsPrevBtn")?.addEventListener("click", () => {
      dnsUi.page = Math.max(1, dnsUi.page - 1);
      renderDns();
    });
    el("dnsNextBtn")?.addEventListener("click", () => {
      dnsUi.page += 1;
      renderDns();
    });
  }

  function installTunnelWorkspace() {
    const page = el("page-tunnels");
    const grid = el("tunnelGrid");
    const panel = el("tunnelRoutePanel");
    if (!page || !grid || !panel || el("tunnelWorkspace")) return;

    const workspace = document.createElement("div");
    workspace.id = "tunnelWorkspace";
    workspace.className = "tunnel-workspace";
    grid.parentNode.insertBefore(workspace, grid);
    workspace.appendChild(grid);
    workspace.appendChild(panel);

    const eyebrow = panel.querySelector(".eyebrow");
    if (eyebrow) eyebrow.textContent = "Tunnel domains & published routes";
    const headActions = panel.querySelector(".route-head-actions");
    if (headActions && !el("routeTokenBtn")) {
      const token = document.createElement("button");
      token.id = "routeTokenBtn";
      token.type = "button";
      token.className = "button secondary";
      token.textContent = "Connector token";
      const remove = document.createElement("button");
      remove.id = "routeDeleteTunnelBtn";
      remove.type = "button";
      remove.className = "button danger ghost";
      remove.textContent = "Delete tunnel";
      headActions.insertBefore(token, headActions.lastElementChild);
      headActions.insertBefore(remove, headActions.lastElementChild);
    }

    const strip = panel.querySelector(".route-info-strip");
    if (strip && !el("routeSearch")) {
      const search = document.createElement("span");
      search.className = "route-search-row";
      search.innerHTML = '<input id="routeSearch" placeholder="Search hostname or service…"><select id="routePageSize"><option value="10" selected>10 / page</option><option value="20">20 / page</option><option value="50">50 / page</option></select>';
      strip.appendChild(search);
    }
    const tableWrap = panel.querySelector(".table-wrap");
    if (tableWrap && !el("routePager")) {
      const pager = document.createElement("div");
      pager.id = "routePager";
      pager.className = "pager route-pager";
      pager.innerHTML = '<span id="routePageInfo">Page 1</span><div class="pager-actions"><button class="mini" id="routePrevBtn" type="button">Previous</button><button class="mini" id="routeNextBtn" type="button">Next</button></div>';
      tableWrap.insertAdjacentElement("afterend", pager);
    }

    el("routeSearch")?.addEventListener("input", (event) => {
      routeState.search = event.target.value.trim().toLowerCase();
      routeState.page = 1;
      routeState.focusHostname = "";
      renderRouteDetail();
    });
    el("routePageSize")?.addEventListener("change", (event) => {
      routeState.pageSize = Number(event.target.value) || 10;
      routeState.page = 1;
      renderRouteDetail();
    });
    el("routePrevBtn")?.addEventListener("click", () => {
      routeState.page = Math.max(1, routeState.page - 1);
      renderRouteDetail();
    });
    el("routeNextBtn")?.addEventListener("click", () => {
      routeState.page += 1;
      renderRouteDetail();
    });
    el("routeTokenBtn")?.addEventListener("click", () => {
      if (routeState.tunnelId && typeof showToken === "function") showToken(routeState.tunnelId);
    });
    el("routeDeleteTunnelBtn")?.addEventListener("click", async () => {
      const tunnel = routeState.tunnels.find((item) => item.id === routeState.tunnelId);
      if (!tunnel || !confirm(`Delete tunnel "${tunnel.name}"?`)) return;
      try {
        unwrap(await cf.deleteTunnel(tunnel.id));
        closeTunnel();
        await refreshAll();
        notify("Tunnel deleted.");
      } catch (error) {
        notify(error.message, true);
      }
    });
  }

  function findTunnelByTarget(content) {
    const target = String(content || "").trim().replace(/\.$/, "");
    const match = target.match(/^([0-9a-f-]{36})\.cfargotunnel\.com$/i);
    if (!match) return null;
    return state.tunnels.find((tunnel) => String(tunnel.id).toLowerCase() === match[1].toLowerCase()) || null;
  }

  function filteredDns() {
    if (!dnsUi.search) return state.dns;
    return state.dns.filter((record) => {
      const tunnel = findTunnelByTarget(record.content);
      const values = [record.type, record.name, record.content, tunnel?.name, JSON.stringify(record.data || {})];
      return values.some((value) => String(value || "").toLowerCase().includes(dnsUi.search));
    });
  }

  function dnsContentCell(record) {
    const tunnel = findTunnelByTarget(record.content);
    if (!tunnel) return `<span title="${esc(record.content)}">${esc(record.content)}</span>`;
    return `<button type="button" class="tunnel-link" data-open-tunnel="${esc(tunnel.id)}" data-open-hostname="${esc(record.name)}" title="Open ${esc(tunnel.name)} in Zero Trust Tunnels"><strong>Tunnel: ${esc(tunnel.name)}</strong><small>${esc(record.content)}</small></button>`;
  }

  renderZones = function renderZonesClean() {
    const select = el("zoneSelect");
    if (!select) return;
    const current = state.selectedZoneId;
    const query = dnsUi.zoneFilter;
    let matches = query ? state.zones.filter((zone) => zone.name.toLowerCase().includes(query)) : state.zones.slice();
    const selected = state.zones.find((zone) => zone.id === current);
    if (selected && !matches.some((zone) => zone.id === selected.id)) matches = [selected, ...matches];
    select.innerHTML = `<option value="">Select a domain</option>${matches.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join("")}`;
    if (state.zones.some((zone) => zone.id === current)) select.value = current;
    else state.selectedZoneId = "";
    el("deleteZoneBtn").disabled = !state.selectedZoneId;
    el("newDnsBtn").disabled = !state.selectedZoneId;
    const status = el("zoneSearchStatus");
    if (status) status.textContent = query ? (matches.length ? `${matches.length} matching domain${matches.length === 1 ? "" : "s"}` : "No managed domain matches") : `${state.zones.length} managed domains`;
  };

  renderDns = function renderDnsClean() {
    const zone = state.zones.find((item) => item.id === state.selectedZoneId);
    el("deleteZoneBtn").disabled = !zone;
    el("newDnsBtn").disabled = !zone;
    if (!zone) {
      el("dnsCaption").textContent = "Choose a domain to view DNS.";
      el("dnsTable").innerHTML = '<tr><td colspan="6" class="muted center">No domain selected.</td></tr>';
      if (el("dnsPager")) el("dnsPager").hidden = true;
      return;
    }

    const records = filteredDns();
    const totalPages = Math.max(1, Math.ceil(records.length / dnsUi.pageSize));
    dnsUi.page = Math.min(dnsUi.page, totalPages);
    const start = (dnsUi.page - 1) * dnsUi.pageSize;
    const pageRecords = records.slice(start, start + dnsUi.pageSize);
    el("dnsCaption").textContent = dnsUi.search
      ? `${records.length} matching records of ${state.dns.length} for ${zone.name}`
      : `${state.dns.length} records for ${zone.name}`;

    if (!pageRecords.length) {
      el("dnsTable").innerHTML = `<tr><td colspan="6" class="muted center">${dnsUi.search ? "No DNS records match your search." : "No DNS records found."}</td></tr>`;
    } else {
      el("dnsTable").innerHTML = pageRecords.map((record) => `<tr><td><span class="badge">${esc(record.type)}</span></td><td>${esc(record.name)}</td><td class="content-cell">${dnsContentCell(record)}</td><td>${record.proxied === true ? "Proxied" : record.proxied === false ? "DNS only" : "—"}</td><td>${record.ttl === 1 ? "Auto" : esc(record.ttl)}</td><td><div class="row-actions"><button class="mini" data-dns-edit="${esc(record.id)}">Edit</button><button class="mini danger" data-dns-remove="${esc(record.id)}">Delete</button></div></td></tr>`).join("");
    }

    if (el("dnsPager")) {
      el("dnsPager").hidden = false;
      el("dnsPageInfo").textContent = records.length ? `Showing ${start + 1}–${Math.min(start + dnsUi.pageSize, records.length)} of ${records.length} • Page ${dnsUi.page} of ${totalPages}` : "0 records";
      el("dnsPrevBtn").disabled = dnsUi.page <= 1;
      el("dnsNextBtn").disabled = dnsUi.page >= totalPages;
    }
  };

  renderDashboard = function renderDashboardClean() {
    const zones = el("dashboardZones");
    const tunnels = el("dashboardTunnels");
    zones.className = state.zones.length ? "stack" : "stack empty-state";
    zones.innerHTML = state.zones.length ? state.zones.slice(0, 6).map((zone) => `<div class="list-row"><button class="dashboard-click" type="button" data-open-zone="${esc(zone.id)}"><strong>${esc(zone.name)}</strong><small>${esc(zone.status || "unknown")}</small></button><span class="badge">${esc(zone.type || "zone")}</span></div>`).join("") : "No domains loaded.";
    tunnels.className = state.tunnels.length ? "stack" : "stack empty-state";
    tunnels.innerHTML = state.tunnels.length ? state.tunnels.slice(0, 6).map((tunnel) => `<div class="list-row"><button class="dashboard-click" type="button" data-open-tunnel="${esc(tunnel.id)}"><strong>${esc(tunnel.name)}</strong><small>${esc(tunnel.id)}</small></button><span class="badge ${esc(tunnel.status)}">${esc(tunnel.status || "unknown")}</span></div>`).join("") : "No tunnels loaded.";
  };

  renderTunnels = function renderTunnelNodes() {
    const grid = el("tunnelGrid");
    if (!grid) return;
    grid.className = "tunnel-node-list";
    if (!state.tunnels.length) {
      grid.innerHTML = '<article class="panel empty-state">No tunnels found.</article>';
      return;
    }
    grid.innerHTML = state.tunnels.map((tunnel) => `<button type="button" class="tunnel-node ${routeState.tunnelId === tunnel.id ? "selected" : ""}" data-manage-routes="${esc(tunnel.id)}"><span><strong>${esc(tunnel.name)}</strong><small>${esc(tunnel.id)}</small></span><span class="tunnel-node-side"><span class="badge ${esc(tunnel.status)}">${esc(tunnel.status || "unknown")}</span><span class="tunnel-open">Open node ›</span></span></button>`).join("");
  };

  function routes() {
    const ingress = routeState.config?.config?.ingress;
    return Array.isArray(ingress) ? ingress.filter((rule) => rule?.hostname) : [];
  }

  function zoneFor(hostname) {
    const host = String(hostname || "").toLowerCase();
    return routeState.zones.filter((zone) => host === zone.name.toLowerCase() || host.endsWith(`.${zone.name.toLowerCase()}`)).sort((a, b) => b.name.length - a.name.length)[0] || null;
  }

  function configCount(route) {
    return Object.values(route?.originRequest || {}).filter((value) => value !== undefined && value !== null && value !== "" && value !== false).length;
  }

  function filteredRoutes() {
    const list = routes().map((route, index) => ({ route, index }));
    if (!routeState.search) return list;
    return list.filter(({ route }) => [route.hostname, route.path, route.service, JSON.stringify(route.originRequest || {})].some((value) => String(value || "").toLowerCase().includes(routeState.search)));
  }

  async function loadTunnel(tunnelId, scroll = true, focusHostname = "") {
    routeState.tunnelId = tunnelId;
    routeState.config = null;
    routeState.focusHostname = String(focusHostname || "").toLowerCase();
    routeState.search = routeState.focusHostname || "";
    routeState.page = 1;
    if (el("routeSearch")) el("routeSearch").value = routeState.search;
    el("tunnelWorkspace")?.classList.add("has-selection");
    renderTunnels();
    renderRouteDetail();
    try {
      const [zones, tunnels, config] = await Promise.all([cf.listZones(), cf.listTunnels(), cf.getTunnelConfiguration(tunnelId)]);
      routeState.zones = unwrap(zones);
      routeState.tunnels = unwrap(tunnels);
      routeState.config = unwrap(config);
      renderRouteDetail();
      renderTunnels();
      if (scroll) el("tunnelRoutePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      notify(error.message, true);
    }
  }

  function closeTunnel() {
    routeState.tunnelId = "";
    routeState.config = null;
    routeState.search = "";
    routeState.focusHostname = "";
    routeState.page = 1;
    if (el("routeSearch")) el("routeSearch").value = "";
    el("tunnelWorkspace")?.classList.remove("has-selection");
    el("tunnelRoutePanel").hidden = true;
    renderTunnels();
  }

  function renderRouteDetail() {
    const panel = el("tunnelRoutePanel");
    if (!panel) return;
    if (!routeState.tunnelId) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const tunnel = routeState.tunnels.find((item) => item.id === routeState.tunnelId) || state.tunnels.find((item) => item.id === routeState.tunnelId);
    el("routeTunnelName").textContent = tunnel?.name || "Cloudflare Tunnel";
    el("routeTunnelMeta").textContent = `${routeState.tunnelId} • ${tunnel?.status || "unknown"}`;
    el("routeDnsTarget").textContent = `${routeState.tunnelId}.cfargotunnel.com`;

    if (!routeState.config) {
      el("routeCount").textContent = "—";
      el("routeSource").textContent = "Loading node configuration…";
      el("routeTable").innerHTML = '<tr><td colspan="6" class="muted center">Loading domains and routes…</td></tr>';
      return;
    }

    const allRoutes = routes();
    const matches = filteredRoutes();
    const local = routeState.config.source === "local";
    const totalPages = Math.max(1, Math.ceil(matches.length / routeState.pageSize));
    routeState.page = Math.min(routeState.page, totalPages);
    const start = (routeState.page - 1) * routeState.pageSize;
    const visible = matches.slice(start, start + routeState.pageSize);
    el("routeCount").textContent = allRoutes.length;
    el("routeSource").textContent = local ? "Locally managed tunnel" : "Remotely managed tunnel";
    el("newRouteBtn").disabled = local;
    if (el("routeTokenBtn")) el("routeTokenBtn").disabled = false;

    if (!visible.length) {
      el("routeTable").innerHTML = `<tr><td colspan="6" class="muted center">${routeState.search ? "No routes match your search." : "No published application routes on this node."}</td></tr>`;
    } else {
      el("routeTable").innerHTML = visible.map(({ route, index }) => `<tr class="${routeState.focusHostname && route.hostname.toLowerCase() === routeState.focusHostname ? "route-host-focus" : ""}"><td><span class="route-number">${index + 1}</span></td><td class="route-host"><strong>${esc(route.hostname)}</strong><small>${esc(zoneFor(route.hostname)?.name || "Zone not matched")}</small></td><td>${esc(route.path || "*")}</td><td><span class="service-code" title="${esc(route.service)}">${esc(route.service)}</span></td><td><span class="origin-count">${configCount(route)}</span></td><td><div class="route-controls"><button class="mini" data-route-move="up" data-route-index="${index}" ${index === 0 || local ? "disabled" : ""}>↑</button><button class="mini" data-route-move="down" data-route-index="${index}" ${index === allRoutes.length - 1 || local ? "disabled" : ""}>↓</button><button class="mini" data-route-edit="${index}" ${local ? "disabled" : ""}>Edit</button><button class="mini danger" data-route-delete="${index}" ${local ? "disabled" : ""}>Delete</button></div></td></tr>`).join("");
    }

    if (el("routePageInfo")) {
      el("routePageInfo").textContent = matches.length ? `Showing ${start + 1}–${Math.min(start + routeState.pageSize, matches.length)} of ${matches.length} matching route${matches.length === 1 ? "" : "s"}` : "0 routes";
      el("routePrevBtn").disabled = routeState.page <= 1;
      el("routeNextBtn").disabled = routeState.page >= totalPages;
    }
  }

  function routeEditor(index = null) {
    const route = Number.isInteger(index) ? routes()[index] : null;
    const currentZone = route ? zoneFor(route.hostname) : routeState.zones[0];
    if (!routeState.zones.length) {
      notify("No Cloudflare domains were found.", true);
      return;
    }
    const dialog = el("modal");
    const form = el("modalForm");
    el("modalTitle").textContent = route ? "Edit published route" : "Add published route";
    el("modalSubmit").textContent = route ? "Save route" : "Publish route";
    el("modalSubmit").style.display = "";
    el("modalBody").innerHTML = `<div class="modal-fields"><label><span>Domain</span><select name="routeZone">${routeState.zones.map((zone) => `<option value="${esc(zone.id)}" ${zone.id === currentZone?.id ? "selected" : ""}>${esc(zone.name)}</option>`).join("")}</select></label><label><span>Full hostname</span><input name="routeHostname" required value="${esc(route?.hostname || "")}" placeholder="app.example.com"></label><div class="inline"><label><span>Path</span><input name="routePath" value="${esc(route?.path || "")}" placeholder="Optional, for example /api/*"></label><label><span>Service</span><input name="routeService" required value="${esc(route?.service || "")}" placeholder="http://localhost:8080"></label></div><label class="check-row"><input name="routeDns" type="checkbox" checked><span>Manage the matching tunnel DNS record automatically</span></label></div>`;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const button = el("modalSubmit");
      try {
        button.disabled = true;
        unwrap(await cf.savePublicRoute({ tunnelId: routeState.tunnelId, routeIndex: route ? index : null, zoneId: data.get("routeZone"), originalZoneId: route ? zoneFor(route.hostname)?.id || "" : "", hostname: data.get("routeHostname"), path: data.get("routePath"), service: data.get("routeService"), originRequest: route?.originRequest || {}, manageDns: data.get("routeDns") === "on" }));
        dialog.close();
        notify(route ? "Route updated." : "Route published.");
        await loadTunnel(routeState.tunnelId, false);
        el("refreshBtn")?.click();
      } catch (error) {
        notify(error.message, true);
      } finally {
        button.disabled = false;
      }
    };
    dialog.showModal();
  }

  async function removeRoute(index) {
    const route = routes()[index];
    if (!route || !confirm(`Delete ${route.hostname}${route.path ? ` ${route.path}` : ""}?`)) return;
    try {
      unwrap(await cf.removePublicRoute({ tunnelId: routeState.tunnelId, routeIndex: index, zoneId: zoneFor(route.hostname)?.id || "", removeDns: true }));
      notify("Route deleted.");
      await loadTunnel(routeState.tunnelId, false);
      el("refreshBtn")?.click();
    } catch (error) {
      notify(error.message, true);
    }
  }

  async function moveRoute(index, direction) {
    try {
      unwrap(await cf.movePublicRoute({ tunnelId: routeState.tunnelId, routeIndex: index, direction }));
      await loadTunnel(routeState.tunnelId, false);
    } catch (error) {
      notify(error.message, true);
    }
  }

  async function openTunnelFromAnywhere(tunnelId, hostname = "") {
    if (typeof nav === "function") nav("tunnels");
    await loadTunnel(tunnelId, true, hostname);
  }
  window.CFPanelOpenTunnel = openTunnelFromAnywhere;

  document.addEventListener("click", async (event) => {
    const manage = event.target.closest("[data-manage-routes]");
    if (manage) return loadTunnel(manage.dataset.manageRoutes);

    const tunnelLink = event.target.closest("[data-open-tunnel]");
    if (tunnelLink) return openTunnelFromAnywhere(tunnelLink.dataset.openTunnel, tunnelLink.dataset.openHostname || "");

    const zoneLink = event.target.closest("[data-open-zone]");
    if (zoneLink) {
      state.selectedZoneId = zoneLink.dataset.openZone;
      dnsUi.page = 1;
      if (typeof nav === "function") nav("domains");
      renderZones();
      return loadDns(state.selectedZoneId);
    }

    const edit = event.target.closest("[data-route-edit]");
    if (edit) return routeEditor(Number(edit.dataset.routeEdit));
    const remove = event.target.closest("[data-route-delete]");
    if (remove) return removeRoute(Number(remove.dataset.routeDelete));
    const move = event.target.closest("[data-route-move]");
    if (move) return moveRoute(Number(move.dataset.routeIndex), move.dataset.routeMove);
  });

  el("newRouteBtn")?.addEventListener("click", () => routeEditor());
  el("closeRoutePanelBtn")?.addEventListener("click", closeTunnel);

  installStyles();
  installModalCloseFix();
  installSimpleNavigation();
  installDnsTools();
  installTunnelWorkspace();
})();
