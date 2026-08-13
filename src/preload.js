const { contextBridge, ipcRenderer } = require("electron");
const call = (channel, args) => ipcRenderer.invoke(channel, args);

contextBridge.exposeInMainWorld("cfpanel", {
  getSettings: () => call("settings:get"),
  saveSettings: (settings) => call("settings:save", settings),
  clearToken: () => call("settings:clearToken"),
  verify: () => call("cloudflare:verify"),
  listZones: () => call("zones:list"),
  createZone: (name) => call("zones:create", { name }),
  deleteZone: (zoneId) => call("zones:delete", { zoneId }),
  listDns: (zoneId) => call("dns:list", { zoneId }),
  createDns: (zoneId, record) => call("dns:create", { zoneId, record }),
  updateDns: (zoneId, recordId, record) => call("dns:update", { zoneId, recordId, record }),
  deleteDns: (zoneId, recordId) => call("dns:delete", { zoneId, recordId }),
  listTunnels: () => call("tunnels:list"),
  createTunnel: (name) => call("tunnels:create", { name }),
  deleteTunnel: (tunnelId) => call("tunnels:delete", { tunnelId }),
  getTunnelToken: (tunnelId) => call("tunnels:token", { tunnelId }),
  getTunnelConfig: (tunnelId) => call("tunnels:config", { tunnelId }),
  getTunnelConfiguration: (tunnelId) => call("tunnels:configuration", { tunnelId }),
  savePublicRoute: (args) => call("tunnels:saveRoute", args),
  removePublicRoute: (args) => call("tunnels:removeRoute", args),
  movePublicRoute: (args) => call("tunnels:moveRoute", args),
  addPublicHostname: (args) => call("tunnels:addHostname", args),
  removePublicHostname: (args) => call("tunnels:removeHostname", args),
  copy: (text) => call("system:copy", { text })
});
