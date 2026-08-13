(function () {
  const cf = window.cfpanel;
  const routeState = { tunnelId: "", zones: [], tunnels: [], config: null };
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

  function routes() {
    const ingress = routeState.config?.config?.ingress;
    return Array.isArray(ingress) ? ingress.filter((rule) => rule?.hostname) : [];
  }

  function zoneFor(hostname) {
    const host = String(hostname || "").toLowerCase();
    return routeState.zones
      .filter((zone) => host === zone.name.toLowerCase() || host.endsWith(`.${zone.name.toLowerCase()}`))
      .sort((a, b) => b.name.length - a.name.length)[0] || null;
  }

  function configCount(route) {
    return Object.values(route?.originRequest || {}).filter((value) => value !== undefined && value !== null && value !== "" && value !== false).length;
  }

  async function loadTunnel(tunnelId, scroll = true) {
    routeState.tunnelId = tunnelId;
    routeState.config = null;
    render();
    try {
      const [zones, tunnels, config] = await Promise.all([
        cf.listZones(),
        cf.listTunnels(),
        cf.getTunnelConfiguration(tunnelId)
      ]);
      routeState.zones = unwrap(zones);
      routeState.tunnels = unwrap(tunnels);
      routeState.config = unwrap(config);
      render();
      markCards();
      if (scroll) el("tunnelRoutePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      notify(error.message, true);
    }
  }

  function render() {
    const panel = el("tunnelRoutePanel");
    if (!panel) return;
    if (!routeState.tunnelId) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    const tunnel = routeState.tunnels.find((item) => item.id === routeState.tunnelId);
    el("routeTunnelName").textContent = tunnel?.name || "Cloudflare Tunnel";
    el("routeTunnelMeta").textContent = `${routeState.tunnelId} • ${tunnel?.status || "unknown"}`;
    el("routeDnsTarget").textContent = `${routeState.tunnelId}.cfargotunnel.com`;

    if (!routeState.config) {
      el("routeCount").textContent = "—";
      el("routeSource").textContent = "Loading configuration…";
      el("routeTable").innerHTML = '<tr><td colspan="6" class="muted center">Loading routes…</td></tr>';
      return;
    }

    const list = routes();
    const local = routeState.config.source === "local";
    el("routeCount").textContent = list.length;
    el("routeSource").textContent = local ? "Locally managed tunnel" : "Remotely managed tunnel";
    el("newRouteBtn").disabled = local;

    if (!list.length) {
      el("routeTable").innerHTML = '<tr><td colspan="6" class="muted center">No published application routes on this tunnel.</td></tr>';
      return;
    }

    el("routeTable").innerHTML = list.map((route, index) => `
      <tr>
        <td><span class="route-number">${index + 1}</span></td>
        <td class="route-host"><strong>${esc(route.hostname)}</strong><small>${esc(zoneFor(route.hostname)?.name || "Zone not matched")}</small></td>
        <td>${esc(route.path || "*")}</td>
        <td><span class="service-code" title="${esc(route.service)}">${esc(route.service)}</span></td>
        <td><span class="origin-count">${configCount(route)}</span></td>
        <td><div class="route-controls">
          <button class="mini" data-route-move="up" data-route-index="${index}" ${index === 0 || local ? "disabled" : ""}>↑</button>
          <button class="mini" data-route-move="down" data-route-index="${index}" ${index === list.length - 1 || local ? "disabled" : ""}>↓</button>
          <button class="mini" data-route-edit="${index}" ${local ? "disabled" : ""}>Edit</button>
          <button class="mini danger" data-route-delete="${index}" ${local ? "disabled" : ""}>Delete</button>
        </div></td>
      </tr>`).join("");
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
    el("modalTitle").textContent = route ? "Edit published application route" : "Add published application route";
    el("modalSubmit").textContent = route ? "Save route" : "Publish route";
    el("modalSubmit").style.display = "";
    el("modalBody").innerHTML = `<div class="modal-fields">
      <label><span>Domain</span><select name="routeZone">${routeState.zones.map((zone) => `<option value="${esc(zone.id)}" ${zone.id === currentZone?.id ? "selected" : ""}>${esc(zone.name)}</option>`).join("")}</select></label>
      <label><span>Full hostname</span><input name="routeHostname" required value="${esc(route?.hostname || "")}" placeholder="app.example.com"></label>
      <div class="inline">
        <label><span>Path</span><input name="routePath" value="${esc(route?.path || "")}" placeholder="/api/*"></label>
        <label><span>Service</span><input name="routeService" required value="${esc(route?.service || "")}" placeholder="http://localhost:8080"></label>
      </div>
      <label class="check-row"><input name="routeDns" type="checkbox" checked><span>Manage the tunnel DNS record automatically</span></label>
    </div>`;

    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const button = el("modalSubmit");
      try {
        button.disabled = true;
        unwrap(await cf.savePublicRoute({
          tunnelId: routeState.tunnelId,
          routeIndex: route ? index : null,
          zoneId: data.get("routeZone"),
          originalZoneId: route ? zoneFor(route.hostname)?.id || "" : "",
          hostname: data.get("routeHostname"),
          path: data.get("routePath"),
          service: data.get("routeService"),
          originRequest: route?.originRequest || {},
          manageDns: data.get("routeDns") === "on"
        }));
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
      unwrap(await cf.removePublicRoute({
        tunnelId: routeState.tunnelId,
        routeIndex: index,
        zoneId: zoneFor(route.hostname)?.id || "",
        removeDns: true
      }));
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

  function markCards() {
    document.querySelectorAll("[data-tunnel-host]").forEach((button) => {
      const tunnelId = button.dataset.tunnelHost;
      const card = button.closest(".tunnel-card");
      const actions = button.closest(".tunnel-actions");
      if (!card || !actions) return;
      card.classList.toggle("selected", tunnelId === routeState.tunnelId);
      if (actions.querySelector(`[data-manage-routes="${tunnelId}"]`)) return;
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "mini";
      manage.dataset.manageRoutes = tunnelId;
      manage.textContent = "Manage routes";
      actions.insertBefore(manage, button);
    });
  }

  document.addEventListener("click", async (event) => {
    const manage = event.target.closest("[data-manage-routes]");
    if (manage) return loadTunnel(manage.dataset.manageRoutes);

    const edit = event.target.closest("[data-route-edit]");
    if (edit) return routeEditor(Number(edit.dataset.routeEdit));

    const remove = event.target.closest("[data-route-delete]");
    if (remove) return removeRoute(Number(remove.dataset.routeDelete));

    const move = event.target.closest("[data-route-move]");
    if (move) return moveRoute(Number(move.dataset.routeIndex), move.dataset.routeMove);
  });

  el("newRouteBtn")?.addEventListener("click", () => routeEditor());
  el("closeRoutePanelBtn")?.addEventListener("click", () => {
    routeState.tunnelId = "";
    routeState.config = null;
    render();
    markCards();
  });

  const grid = el("tunnelGrid");
  if (grid) new MutationObserver(markCards).observe(grid, { childList: true, subtree: true });
  markCards();
})();
