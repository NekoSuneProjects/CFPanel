const path = require("node:path");
const { app, BrowserWindow, ipcMain, clipboard, shell } = require("electron");
const { CloudflareClient } = require("./cloudflare");
const { CloudflarePlusClient } = require("./cloudflare-plus");
const store = require("./store");

function client() {
  return new CloudflareClient(store.getCredentials());
}

function plusClient() {
  return new CloudflarePlusClient(store.getCredentials());
}

const PLUS_ACTIONS = new Set([
  "listZoneSettings", "updateZoneSetting", "getUniversalSsl", "setUniversalSsl", "purgeCache", "batchDns", "zoneAnalytics",
  "listWorkers", "downloadWorker", "uploadWorker", "deleteWorker", "listWorkerRoutes", "createWorkerRoute", "updateWorkerRoute", "deleteWorkerRoute",
  "listAccessApps", "createAccessApp", "updateAccessApp", "deleteAccessApp", "listAccessPolicies", "createAccessPolicy", "updateAccessPolicy", "deleteAccessPolicy",
  "listPrivateRoutes", "createPrivateRoute", "updatePrivateRoute", "deletePrivateRoute", "listGatewayLists", "createGatewayList", "updateGatewayList", "deleteGatewayList",
  "listRulesets", "getRuleset", "createRuleset", "updateRuleset", "deleteRuleset", "graphql", "apiExplorer"
]);

function serializeError(error) {
  return {
    message: error?.message || "Unknown error",
    details: error?.details || []
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, async (_event, args) => {
    try {
      return { ok: true, data: await handler(args || {}) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: "#07110d",
    title: "CFPanel",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  register("settings:get", () => store.getSettings());
  register("settings:save", (args) => store.saveSettings(args));
  register("settings:clearToken", () => store.clearToken());

  register("cloudflare:verify", () => client().verifyToken());
  register("zones:list", () => client().listZones());
  register("zones:create", (args) => client().createZone(args));
  register("zones:delete", ({ zoneId }) => client().deleteZone(zoneId));

  register("dns:list", ({ zoneId }) => client().listDns(zoneId));
  register("dns:create", ({ zoneId, record }) => client().createDns(zoneId, record));
  register("dns:update", ({ zoneId, recordId, record }) => client().updateDns(zoneId, recordId, record));
  register("dns:delete", ({ zoneId, recordId }) => client().deleteDns(zoneId, recordId));

  register("tunnels:list", () => client().listTunnels());
  register("tunnels:create", ({ name }) => client().createTunnel(name));
  register("tunnels:delete", ({ tunnelId }) => client().deleteTunnel(tunnelId));
  register("tunnels:token", ({ tunnelId }) => client().getTunnelToken(tunnelId));
  register("tunnels:config", ({ tunnelId }) => client().getTunnelConfig(tunnelId));
  register("tunnels:configuration", ({ tunnelId }) => client().getTunnelConfiguration(tunnelId));
  register("tunnels:saveRoute", (args) => client().savePublicRoute(args));
  register("tunnels:removeRoute", (args) => client().removePublicRoute(args));
  register("tunnels:moveRoute", (args) => client().movePublicRoute(args));
  register("tunnels:addHostname", (args) => client().addPublicHostname(args));
  register("tunnels:removeHostname", (args) => client().removePublicHostname(args));

  register("plus:call", async ({ action, args = [] }) => {
    if (!PLUS_ACTIONS.has(action)) throw new Error("Unsupported CFPanel feature action.");
    const target = plusClient()[action];
    if (typeof target !== "function") throw new Error("CFPanel feature is unavailable.");
    return target.apply(plusClient(), Array.isArray(args) ? args : [args]);
  });

  register("system:copy", ({ text }) => clipboard.writeText(String(text || "")));

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
