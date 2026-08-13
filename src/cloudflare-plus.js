const { CloudflareClient, CloudflareError } = require("./cloudflare");

const API = "https://api.cloudflare.com/client/v4";

class CloudflarePlusClient extends CloudflareClient {
  async rawRequest(path, options = {}) {
    this.assertToken();
    const cleanPath = String(path || "").trim();
    if (!cleanPath.startsWith("/") || cleanPath.startsWith("//")) {
      throw new Error("Cloudflare API path must start with a single /.");
    }

    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      ...(options.headers || {})
    };
    let body = options.body;
    if (body && options.json !== false && !(body instanceof FormData)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      if (typeof body !== "string") body = JSON.stringify(body);
    }

    const response = await fetch(`${API}${cleanPath}`, {
      method: options.method || "GET",
      headers,
      body
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let payload = text;
    if (contentType.includes("json") || options.expectJson) {
      try { payload = text ? JSON.parse(text) : {}; }
      catch { throw new CloudflareError(`Cloudflare returned invalid JSON (${response.status}).`); }
    }

    if (!response.ok || payload?.success === false) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];
      const message = errors.map((item) => item.message).filter(Boolean).join("; ")
        || `Cloudflare API request failed (${response.status}).`;
      throw new CloudflareError(message, errors);
    }
    return payload;
  }

  async listZoneSettings(zoneId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/settings`)).result || [];
  }

  async updateZoneSetting(zoneId, settingId, value) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/settings/${encodeURIComponent(settingId)}`, {
      method: "PATCH",
      body: { value }
    })).result;
  }

  async getUniversalSsl(zoneId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/ssl/universal/settings`)).result || {};
  }

  async setUniversalSsl(zoneId, enabled) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/ssl/universal/settings`, {
      method: "PATCH",
      body: { enabled: Boolean(enabled) }
    })).result;
  }

  async purgeCache(zoneId, payload = { purge_everything: true }) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
      method: "POST",
      body: payload
    })).result;
  }

  async batchDns(zoneId, operations) {
    const body = {
      deletes: Array.isArray(operations?.deletes) ? operations.deletes : [],
      patches: Array.isArray(operations?.patches) ? operations.patches : [],
      puts: Array.isArray(operations?.puts) ? operations.puts : [],
      posts: Array.isArray(operations?.posts) ? operations.posts : []
    };
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/dns_records/batch`, {
      method: "POST",
      body
    })).result;
  }

  async graphql(query, variables = {}) {
    const payload = await this.rawRequest("/graphql", {
      method: "POST",
      body: { query, variables },
      expectJson: true
    });
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new CloudflareError(payload.errors.map((item) => item.message).join("; "), payload.errors);
    }
    return payload.data;
  }

  async zoneAnalytics(zoneId, hours = 24) {
    const safeHours = Math.min(168, Math.max(1, Number(hours) || 24));
    const end = new Date();
    const start = new Date(end.getTime() - safeHours * 3600000);
    const query = `query CFPanelAnalytics($zoneTag: string, $start: Time, $end: Time) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          traffic: httpRequestsAdaptiveGroups(
            limit: 1000,
            orderBy: [datetimeHour_ASC],
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
          ) {
            count
            avg { sampleInterval }
            sum { edgeResponseBytes visits }
            dimensions { datetimeHour }
          }
          firewall: firewallEventsAdaptiveGroups(
            limit: 20,
            orderBy: [count_DESC],
            filter: { datetime_geq: $start, datetime_lt: $end }
          ) {
            count
            dimensions { action }
          }
        }
      }
    }`;
    const data = await this.graphql(query, {
      zoneTag: zoneId,
      start: start.toISOString(),
      end: end.toISOString()
    });
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      zone: data?.viewer?.zones?.[0] || { traffic: [], firewall: [] }
    };
  }

  async listWorkers() {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/workers/scripts`);
    return payload.result || [];
  }

  async downloadWorker(scriptName) {
    this.assertAccount();
    return this.rawRequest(`/accounts/${encodeURIComponent(this.accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`, {
      json: false
    });
  }

  async uploadWorker({ scriptName, code, compatibilityDate }) {
    this.assertAccount();
    const name = String(scriptName || "").trim();
    if (!name) throw new Error("Worker name is required.");
    const moduleName = "index.js";
    const metadata = {
      main_module: moduleName,
      compatibility_date: String(compatibilityDate || new Date().toISOString().slice(0, 10))
    };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    form.append(moduleName, new Blob([String(code || "")], { type: "application/javascript+module" }), moduleName);
    return this.rawRequest(`/accounts/${encodeURIComponent(this.accountId)}/workers/scripts/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: form,
      json: false,
      expectJson: true
    });
  }

  async deleteWorker(scriptName) {
    this.assertAccount();
    return this.rawRequest(`/accounts/${encodeURIComponent(this.accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`, {
      method: "DELETE",
      expectJson: true
    });
  }

  async listWorkerRoutes(zoneId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/workers/routes`)).result || [];
  }

  async createWorkerRoute(zoneId, route) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/workers/routes`, {
      method: "POST",
      body: route
    })).result;
  }

  async updateWorkerRoute(zoneId, routeId, route) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/workers/routes/${encodeURIComponent(routeId)}`, {
      method: "PUT",
      body: route
    })).result;
  }

  async deleteWorkerRoute(zoneId, routeId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/workers/routes/${encodeURIComponent(routeId)}`, {
      method: "DELETE"
    })).result;
  }

  async listAccessApps() {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps?per_page=100`);
    return payload.result || [];
  }

  async createAccessApp(app) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps`, {
      method: "POST",
      body: app
    })).result;
  }

  async updateAccessApp(appId, app) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}`, {
      method: "PUT",
      body: app
    })).result;
  }

  async deleteAccessApp(appId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}`, {
      method: "DELETE"
    })).result;
  }

  async listAccessPolicies(appId) {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}/policies?per_page=100`);
    return payload.result || [];
  }

  async createAccessPolicy(appId, policy) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}/policies`, {
      method: "POST",
      body: policy
    })).result;
  }

  async updateAccessPolicy(appId, policyId, policy) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(policyId)}`, {
      method: "PUT",
      body: policy
    })).result;
  }

  async deleteAccessPolicy(appId, policyId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(policyId)}`, {
      method: "DELETE"
    })).result;
  }

  async listPrivateRoutes() {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/teamnet/routes?per_page=100`);
    return payload.result || [];
  }

  async createPrivateRoute(route) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/teamnet/routes`, {
      method: "POST",
      body: route
    })).result;
  }

  async updatePrivateRoute(routeId, route) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/teamnet/routes/${encodeURIComponent(routeId)}`, {
      method: "PATCH",
      body: route
    })).result;
  }

  async deletePrivateRoute(routeId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/teamnet/routes/${encodeURIComponent(routeId)}`, {
      method: "DELETE"
    })).result;
  }

  async listGatewayLists() {
    this.assertAccount();
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/gateway/lists`);
    return payload.result || [];
  }

  async createGatewayList(list) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/gateway/lists`, {
      method: "POST",
      body: list
    })).result;
  }

  async updateGatewayList(listId, list) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/gateway/lists/${encodeURIComponent(listId)}`, {
      method: "PUT",
      body: list
    })).result;
  }

  async deleteGatewayList(listId) {
    this.assertAccount();
    return (await this.request(`/accounts/${encodeURIComponent(this.accountId)}/gateway/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE"
    })).result;
  }

  async listRulesets(zoneId) {
    const payload = await this.request(`/zones/${encodeURIComponent(zoneId)}/rulesets`);
    return payload.result || [];
  }

  async getRuleset(zoneId, rulesetId) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(rulesetId)}`)).result;
  }

  async createRuleset(zoneId, ruleset) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/rulesets`, {
      method: "POST",
      body: ruleset
    })).result;
  }

  async updateRuleset(zoneId, rulesetId, ruleset) {
    return (await this.request(`/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(rulesetId)}`, {
      method: "PUT",
      body: ruleset
    })).result;
  }

  async deleteRuleset(zoneId, rulesetId) {
    return this.rawRequest(`/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(rulesetId)}`, {
      method: "DELETE",
      expectJson: true
    });
  }

  async apiExplorer({ method, path, body }) {
    const upper = String(method || "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) throw new Error("Unsupported HTTP method.");
    const options = { method: upper, expectJson: true };
    if (body !== undefined && body !== null && body !== "") options.body = body;
    return this.rawRequest(path, options);
  }
}

module.exports = { CloudflarePlusClient };
