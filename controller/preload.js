const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    getSites: () => ipcRenderer.invoke("get-sites"),
    openConfig: () => ipcRenderer.invoke("open-config"),

    // Zjednotená funkcia pre ovládanie
    control: (id, action) => ipcRenderer.invoke("control-site", { id, action }),

    onStatusChange: (callback) =>
        ipcRenderer.on("site-status", (_, data) => callback(data)),
});
