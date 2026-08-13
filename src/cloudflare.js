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

  async getTunnelConfig(tunnelId) {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`);
    return payload.result?.config || { ingress: [{ service: "http_status:404" }] };
  }

  async putTunnelConfig(tunnelId, config) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`, {
      method: "PUT",
      body: { config }
    })).result;
  }

  async addPublicHostname({ tunnelId, zoneId, hostname, service }) {
    const normalizedHostname = String(hostname || "").trim().toLowerCase();
    const normalizedService = String(service || "").trim();
    if (!normalizedHostname || !normalizedService) throw new Error("Hostname and service are required.");

    const config = await this.getTunnelConfig(tunnelId);
    const ingress = Array.isArray(config.ingress) ? config.ingress.filter(Boolean) : [];
    const catchAll = ingress.find((rule) => !rule.hostname) || { service: "http_status:404" };
    const named = ingress.filter((rule) => rule.hostname && rule.hostname !== normalizedHostname);
    named.push({ hostname: normalizedHostname, service: normalizedService, originRequest: {} });

    const nextConfig = { ...config, ingress: [...named, catchAll] };
    await this.putTunnelConfig(tunnelId, nextConfig);

    const existing = (await this.listDns(zoneId)).find(
      (r) => r.name?.toLowerCase() === normalizedHostname && r.type === "CNAME"
    );
    const record = {
      type: "CNAME",
      name: normalizedHostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: "Managed by CFPanel for Cloudflare Tunnel"
    };

    if (existing) {
      await this.updateDns(zoneId, existing.id, record);
    } else {
      await this.createDns(zoneId, record);
    }
    return nextConfig;
  }

  async removePublicHostname({ tunnelId, zoneId, hostname, removeDns = true }) {
    const normalizedHostname = String(hostname || "").trim().toLowerCase();
    const config = await this.getTunnelConfig(tunnelId);
    const ingress = Array.isArray(config.ingress) ? config.ingress.filter(Boolean) : [];
    const catchAll = ingress.find((rule) => !rule.hostname) || { service: "http_status:404" };
    const named = ingress.filter((rule) => rule.hostname && rule.hostname !== normalizedHostname);
    const nextConfig = { ...config, ingress: [...named, catchAll] };
    await this.putTunnelConfig(tunnelId, nextConfig);

    if (removeDns && zoneId) {
      const records = await this.listDns(zoneId);
      const match = records.find(
        (r) => r.name?.toLowerCase() === normalizedHostname
          && r.type === "CNAME"
          && r.content === `${tunnelId}.cfargotunnel.com`
      );
      if (match) await this.deleteDns(zoneId, match.id);
    }
    return nextConfig;
  }
}

module.exports = { CloudflareClient, CloudflareError };
