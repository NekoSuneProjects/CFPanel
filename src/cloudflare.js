const API = "https://api.cloudflare.com/client/v4";

class CloudflareError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "CloudflareError";
    this.details = details;
  }
}

class CloudflareClient {
  constructor({ accountId, apiToken }) {
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  assertToken() {
    if (!this.apiToken) throw new Error("Cloudflare API token is not configured.");
  }

  assertAccount() {
    if (!this.accountId) throw new Error("Cloudflare Account ID is not configured.");
  }

  async request(path, options = {}) {
    this.assertToken();
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new CloudflareError(`Cloudflare returned a non-JSON response (${response.status}).`);
    }

    if (!response.ok || payload.success === false) {
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      const message = errors.map((e) => e.message).filter(Boolean).join("; ")
        || `Cloudflare API request failed (${response.status}).`;
      throw new CloudflareError(message, errors);
    }

    return payload;
  }

  async verifyToken() {
    return this.request("/user/tokens/verify");
  }

  async listZones() {
    const payload = await this.request("/zones?per_page=50&order=name&direction=asc");
    return payload.result || [];
  }

  async createZone({ name }) {
    this.assertAccount();
    return (await this.request("/zones", {
      method: "POST",
      body: { account: { id: this.accountId }, name: String(name || "").trim(), type: "full" }
    })).result;
  }

  async deleteZone(zoneId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}`, {
      method: "DELETE"
    })).result;
  }

  async listDns(zoneId) {
    const payload = await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100&order=name&direction=asc`);
    return payload.result || [];
  }

  async findDns(zoneId, { name, type = "CNAME" }) {
    const query = new URLSearchParams({
      name: String(name || "").trim().toLowerCase(),
      type,
      per_page: "100"
    });
    const payload = await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`);
    return payload.result || [];
  }

  async createDns(zoneId, record) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method: "POST",
      body: record
    })).result;
  }

  async updateDns(zoneId, recordId, record) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
      method: "PUT",
      body: record
    })).result;
  }

  async deleteDns(zoneId, recordId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
      method: "DELETE"
    })).result;
  }

  async listTunnels() {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel?is_deleted=false&per_page=100`);
    return payload.result || [];
  }

  async createTunnel(name) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel`, {
      method: "POST",
      body: { name: String(name || "").trim(), config_src: "cloudflare" }
    })).result;
  }

  async deleteTunnel(tunnelId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`, {
      method: "DELETE"
    })).result;
  }

  async getTunnelToken(tunnelId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`)).result;
  }

  async getTunnelConfiguration(tunnelId) {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`);
    return payload.result || {
      tunnel_id: tunnelId,
      source: "cloudflare",
      config: { ingress: [{ service: "http_status:404" }] }
    };
  }

  async getTunnelConfig(tunnelId) {
    const result = await this.getTunnelConfiguration(tunnelId);
    return result.config || { ingress: [{ service: "http_status:404" }] };
  }

  async putTunnelConfig(tunnelId, config) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`, {
      method: "PUT",
      body: { config }
    })).result;
  }

  splitIngress(config) {
    const ingress = Array.isArray(config?.ingress) ? config.ingress.filter(Boolean) : [];
    const routes = ingress.filter((rule) => rule.hostname);
    const catchAll = [...ingress].reverse().find((rule) => !rule.hostname)
      || { service: "http_status:404" };
    return { routes, catchAll };
  }

  normalizeOriginRequest(originRequest = {}) {
    const result = {};
    if (originRequest.noTLSVerify === true) result.noTLSVerify = true;
    if (String(originRequest.httpHostHeader || "").trim()) {
      result.httpHostHeader = String(originRequest.httpHostHeader).trim();
    }
    if (String(originRequest.originServerName || "").trim()) {
      result.originServerName = String(originRequest.originServerName).trim();
    }
    return result;
  }

  normalizeRoute({ hostname, path, service, originRequest }) {
    const normalizedHostname = String(hostname || "").trim().toLowerCase();
    const normalizedService = String(service || "").trim();
    const normalizedPath = String(path || "").trim();

    if (!normalizedHostname || !normalizedService) {
      throw new Error("Hostname and service are required.");
    }

    const route = {
      hostname: normalizedHostname,
      service: normalizedService,
      originRequest: this.normalizeOriginRequest(originRequest)
    };
    if (normalizedPath && normalizedPath !== "*") route.path = normalizedPath;
    return route;
  }

  async ensureTunnelDns({ zoneId, tunnelId, hostname }) {
    if (!zoneId) return null;
    const target = `${tunnelId}.cfargotunnel.com`;
    const matches = await this.findDns(zoneId, { name: hostname, type: "CNAME" });
    const existing = matches.find((record) => record.name?.toLowerCase() === hostname.toLowerCase());
    const record = {
      type: "CNAME",
      name: hostname,
      content: target,
      proxied: true,
      ttl: 1,
      comment: "Managed by CFPanel for Cloudflare Tunnel"
    };

    if (existing) return this.updateDns(zoneId, existing.id, record);
    return this.createDns(zoneId, record);
  }

  async removeTunnelDns({ zoneId, tunnelId, hostname }) {
    if (!zoneId || !hostname) return false;
    const target = `${tunnelId}.cfargotunnel.com`.toLowerCase();
    const matches = await this.findDns(zoneId, { name: hostname, type: "CNAME" });
    const record = matches.find((item) =>
      item.name?.toLowerCase() === hostname.toLowerCase()
      && String(item.content || "").toLowerCase() === target
    );
    if (!record) return false;
    await this.deleteDns(zoneId, record.id);
    return true;
  }

  async savePublicRoute({
    tunnelId,
    routeIndex,
    zoneId,
    originalZoneId,
    hostname,
    path,
    service,
    originRequest,
    manageDns = true
  }) {
    const config = await this.getTunnelConfig(tunnelId);
    const { routes, catchAll } = this.splitIngress(config);
    const nextRoute = this.normalizeRoute({ hostname, path, service, originRequest });
    const editing = Number.isInteger(routeIndex) && routeIndex >= 0;
    let previous = null;

    if (editing) {
      if (routeIndex >= routes.length) throw new Error("The selected tunnel route no longer exists. Refresh and try again.");
      previous = routes[routeIndex];
      routes[routeIndex] = nextRoute;
    } else {
      routes.push(nextRoute);
    }

    const nextConfig = { ...config, ingress: [...routes, catchAll] };
    await this.putTunnelConfig(tunnelId, nextConfig);

    if (manageDns) {
      await this.ensureTunnelDns({ zoneId, tunnelId, hostname: nextRoute.hostname });
    }

    if (previous && previous.hostname !== nextRoute.hostname) {
      const previousStillUsed = routes.some((rule) => rule.hostname === previous.hostname);
      if (!previousStillUsed && originalZoneId) {
        await this.removeTunnelDns({
          zoneId: originalZoneId,
          tunnelId,
          hostname: previous.hostname
        });
      }
    }

    return nextConfig;
  }

  async removePublicRoute({ tunnelId, routeIndex, zoneId, removeDns = true }) {
    const config = await this.getTunnelConfig(tunnelId);
    const { routes, catchAll } = this.splitIngress(config);
    const index = Number(routeIndex);
    if (!Number.isInteger(index) || index < 0 || index >= routes.length) {
      throw new Error("The selected tunnel route no longer exists. Refresh and try again.");
    }

    const [removed] = routes.splice(index, 1);
    const nextConfig = { ...config, ingress: [...routes, catchAll] };
    await this.putTunnelConfig(tunnelId, nextConfig);

    if (removeDns && zoneId && !routes.some((rule) => rule.hostname === removed.hostname)) {
      await this.removeTunnelDns({ zoneId, tunnelId, hostname: removed.hostname });
    }
    return { config: nextConfig, removed };
  }

  async movePublicRoute({ tunnelId, routeIndex, direction }) {
    const config = await this.getTunnelConfig(tunnelId);
    const { routes, catchAll } = this.splitIngress(config);
    const from = Number(routeIndex);
    const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    const to = from + delta;

    if (!Number.isInteger(from) || !delta || from < 0 || from >= routes.length || to < 0 || to >= routes.length) {
      return config;
    }

    [routes[from], routes[to]] = [routes[to], routes[from]];
    const nextConfig = { ...config, ingress: [...routes, catchAll] };
    await this.putTunnelConfig(tunnelId, nextConfig);
    return nextConfig;
  }

  // Backwards-compatible wrappers used by older CFPanel UI builds.
  async addPublicHostname({ tunnelId, zoneId, hostname, service, path, originRequest }) {
    return this.savePublicRoute({ tunnelId, zoneId, hostname, service, path, originRequest, manageDns: true });
  }

  async removePublicHostname({ tunnelId, zoneId, hostname, removeDns = true }) {
    const config = await this.getTunnelConfig(tunnelId);
    const { routes } = this.splitIngress(config);
    const index = routes.findIndex((rule) => rule.hostname === String(hostname || "").trim().toLowerCase());
    if (index < 0) return config;
    const result = await this.removePublicRoute({ tunnelId, routeIndex: index, zoneId, removeDns });
    return result.config;
  }
}

module.exports = { CloudflareClient, CloudflareError };
