const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { STATUS, COMMANDS } = require("./constants");

app.setAppUserModelId("com.audio.controller");

const MAX_RESTARTS = 5;
const HEARTBEAT_TIMEOUT = 25000;
const RESTART_DELAY = 3000;
const CONFIG_NAME = "sites.json";

let win;
const helpers = new Map(); // Map<id, HelperObject>

/* ================= CONFIG ================= */

const defaultSites = [
    {
        id: "youtube",
        name: "YouTube",
        url: "https://youtube.com",
        autostart: false,
    },
];

function getConfigPath() {
    return path.join(app.getPath("userData"), CONFIG_NAME);
}

function loadSites() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(
            configPath,
            JSON.stringify(defaultSites, null, 2),
            "utf-8"
        );
    }
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/* ================= IPC HANDLERS ================= */

ipcMain.handle("get-sites", () => loadSites());
ipcMain.handle("open-config", async () => shell.openPath(getConfigPath()));

ipcMain.handle("control-site", (_, { id, action }) => {
    const helper = helpers.get(id);
    const sites = loadSites();
    const siteConfig = sites.find((s) => s.id === id);

    // START logic
    if (action === COMMANDS.START) {
        if (!helper && siteConfig) startHelper(siteConfig);
        return;
    }

    if (!helper) return;

    // PREVENCIA BUGU: Ak sa helper ešte len štartuje, ignoruj príkazy (okrem STOP)
    if (helper.status === STATUS.STARTING && action !== COMMANDS.STOP) {
        return;
    }

    switch (action) {
        case COMMANDS.STOP:
            stopHelper(id, true);
            break;
        case COMMANDS.MUTE:
            sendCmd(helper, COMMANDS.MUTE);
            break;
        case COMMANDS.UNMUTE:
            sendCmd(helper, COMMANDS.UNMUTE);
            break;
        case COMMANDS.SHOW:
            sendCmd(helper, COMMANDS.SHOW);
            break;
        case COMMANDS.HIDE:
            sendCmd(helper, COMMANDS.HIDE);
            break;
        case COMMANDS.RELOAD:
            // Nastavíme STARTING, aby UI zamrzlo kým sa reload nedokončí
            updateHelperState(helper, { status: STATUS.STARTING });
            sendCmd(helper, COMMANDS.RELOAD);
            break;
    }
});

/* ================= HELPER LOGIC ================= */

function startHelper(site, prevStats = {}) {
    if (helpers.has(site.id)) return;

    const scriptPath = path.join(__dirname, "../helpers/helper.js");

    const child = spawn(process.execPath, [scriptPath, JSON.stringify(site)], {
        stdio: ["pipe", "pipe", "pipe"],
    });

    const helper = {
        process: child,
        site,
        // State tracking
        status: STATUS.STARTING,
        isMuted: prevStats.isMuted ?? false,
        isVisible: prevStats.isVisible ?? false,

        restarts: prevStats.restarts ?? 0,
        lastHeartbeat: Date.now(),
        userStopped: false,
    };

    helpers.set(site.id, helper);
    notifyRenderer(helper); // Notify immediately that we are starting

    child.stdout.on("data", (data) => {
        const msgs = data.toString().trim().split("\n");
        msgs.forEach((msg) => handleHelperMessage(helper, msg.trim()));
    });

    child.stderr.on("data", (data) =>
        console.error(`[${site.id}] Err:`, data.toString())
    );

    child.on("exit", () => {
        helpers.delete(site.id);
        if (helper.userStopped) {
            // Fake helper object just for notification
            notifyRenderer({ ...helper, status: STATUS.STOPPED });
        } else {
            notifyRenderer({ ...helper, status: STATUS.CRASHED });
            handleCrash(helper);
        }
    });
}

function handleHelperMessage(helper, msg) {
    if (!msg) return;

    if (msg === COMMANDS.HEARTBEAT) {
        helper.lastHeartbeat = Date.now();
        return;
    }

    // Tu aktualizujeme interný stav na základe správ z helpera
    if (msg === STATUS.RUNNING) {
        updateHelperState(helper, { status: STATUS.RUNNING });
        // Restore state
        if (helper.isMuted) sendCmd(helper, COMMANDS.MUTE);
        if (!helper.isVisible) sendCmd(helper, COMMANDS.HIDE);
    } else if (msg === STATUS.MUTED) {
        updateHelperState(helper, { isMuted: true });
    } else if (msg === "unmuted") {
        updateHelperState(helper, { isMuted: false });
    } else if (msg === "shown") {
        updateHelperState(helper, { isVisible: true });
    } else if (msg === "hidden") {
        updateHelperState(helper, { isVisible: false });
    }
}

function updateHelperState(helper, changes) {
    Object.assign(helper, changes);
    notifyRenderer(helper);
}

function stopHelper(id, userInitiated = false) {
    const helper = helpers.get(id);
    if (!helper) return;

    helper.userStopped = userInitiated;
    try {
        helper.process.kill("SIGTERM");
    } catch (e) {}
}

function handleCrash(helper) {
    if (helper.restarts >= MAX_RESTARTS) return;
    helper.restarts++;
    setTimeout(() => startHelper(helper.site, helper), RESTART_DELAY);
}

function sendCmd(helper, cmd) {
    if (helper?.process?.stdin?.writable) {
        helper.process.stdin.write(cmd + "\n");
    }
}

// KĽÚČOVÁ ZMENA: Posielame celý objekt stavu
function notifyRenderer(helper) {
    if (win && !win.isDestroyed()) {
        win.webContents.send("site-status", {
            id: helper.site.id,
            status: helper.status,
            isMuted: helper.isMuted,
            isVisible: helper.isVisible,
        });
    }
}

/* ================= WINDOW ================= */

function createWindow() {
    win = new BrowserWindow({
        width: 950,
        height: 600,
        autoHideMenuBar: true,
        backgroundColor: "#1e1e1e",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
    createWindow();
    loadSites().forEach((site) => site.autostart && startHelper(site));
});
