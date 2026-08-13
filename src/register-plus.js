const { CloudflarePlusClient } = require("./cloudflare-plus");

function registerPlusFeatures(register, store) {
  const plus = () => new CloudflarePlusClient(store.getCredentials());

  register("zones:settings", ({ zoneId }) => plus().listZoneSettings(zoneId));
  register("zones:setSetting", ({ zoneId, settingId, value }) => plus().updateZoneSetting(zoneId, settingId, value));
  register("zones:universalSsl", ({ zoneId }) => plus().getUniversalSsl(zoneId));
  register("zones:setUniversalSsl", ({ zoneId, enabled }) => plus().setUniversalSsl(zoneId, enabled));
  register("zones:analytics", ({ zoneId, hours }) => plus().zoneAnalytics(zoneId, hours));
  register("zones:purgeCache", ({ zoneId, payload }) => plus().purgeCache(zoneId, payload));
  register("dns:batch", ({ zoneId, operations }) => plus().batchDns(zoneId, operations));

  register("zt:privateRoutes", () => plus().listPrivateRoutes());
  register("zt:createPrivateRoute", (args) => plus().createPrivateRoute(args));
  register("zt:updatePrivateRoute", ({ routeId, route }) => plus().updatePrivateRoute(routeId, route));
  register("zt:deletePrivateRoute", ({ routeId }) => plus().deletePrivateRoute(routeId));
  register("zt:gatewayLists", () => plus().listGatewayLists());
  register("zt:createGatewayList", (args) => plus().createGatewayList(args));
  register("zt:updateGatewayList", ({ listId, list }) => plus().updateGatewayList(listId, list));
  register("zt:deleteGatewayList", ({ listId }) => plus().deleteGatewayList(listId));

  register("workers:list", () => plus().listWorkers());
  register("workers:download", ({ scriptName }) => plus().downloadWorker(scriptName));
  register("workers:upload", (args) => plus().uploadWorker(args));
  register("workers:delete", ({ scriptName }) => plus().deleteWorker(scriptName));
  register("workers:routes", ({ zoneId }) => plus().listWorkerRoutes(zoneId));
  register("workers:createRoute", ({ zoneId, route }) => plus().createWorkerRoute(zoneId, route));
  register("workers:updateRoute", ({ zoneId, routeId, route }) => plus().updateWorkerRoute(zoneId, routeId, route));
  register("workers:deleteRoute", ({ zoneId, routeId }) => plus().deleteWorkerRoute(zoneId, routeId));

  register("access:apps", () => plus().listAccessApps());
  register("access:createApp", (args) => plus().createAccessApp(args));
  register("access:updateApp", ({ appId, app }) => plus().updateAccessApp(appId, app));
  register("access:deleteApp", ({ appId }) => plus().deleteAccessApp(appId));
  register("access:policies", ({ appId }) => plus().listAccessPolicies(appId));
  register("access:createPolicy", ({ appId, policy }) => plus().createAccessPolicy(appId, policy));
  register("access:updatePolicy", ({ appId, policyId, policy }) => plus().updateAccessPolicy(appId, policyId, policy));
  register("access:deletePolicy", ({ appId, policyId }) => plus().deleteAccessPolicy(appId, policyId));

  register("rulesets:list", ({ zoneId }) => plus().listRulesets(zoneId));
  register("rulesets:get", ({ zoneId, rulesetId }) => plus().getRuleset(zoneId, rulesetId));
  register("rulesets:create", ({ zoneId, ruleset }) => plus().createRuleset(zoneId, ruleset));
  register("rulesets:update", ({ zoneId, rulesetId, ruleset }) => plus().updateRuleset(zoneId, rulesetId, ruleset));
  register("rulesets:delete", ({ zoneId, rulesetId }) => plus().deleteRuleset(zoneId, rulesetId));

  register("cloudflare:graphql", ({ query, variables }) => plus().graphql(query, variables));
  register("cloudflare:explorer", (args) => plus().apiExplorer(args));
}

module.exports = { registerPlusFeatures };
