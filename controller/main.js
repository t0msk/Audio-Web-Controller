const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { STATUS, COMMANDS } = require("./constants");

/* ================= PREVENCIA DUPLICITY / HELPER CHECK ================= */

const isHelper = process.argv.some((arg) =>
    arg.toLowerCase().includes("helper.js")
);

if (isHelper) {
    return;
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

/* ================= MAIN APP SETUP ================= */

app.setAppUserModelId("com.audio.controller");

const MAX_RESTARTS = 5;
const RESTART_DELAY = 3000;
const CONFIG_NAME = "sites.json";

let win;
const helpers = new Map();

function getConfigPath() {
    return path.join(app.getPath("userData"), CONFIG_NAME);
}

function loadSites() {
    const configPath = getConfigPath();
    const defaultSites = [
        {
            id: "youtube",
            name: "YouTube",
            url: "https://youtube.com",
            autostart: false,
        },
    ];
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

ipcMain.handle("get-sites", () => {
    const configSites = loadSites();
    return configSites.map((site) => {
        const helper = helpers.get(site.id);
        if (helper) {
            // Ak proces beží (alebo štartuje), pošleme jeho aktuálne dáta
            return {
                ...site,
                status: helper.status,
                isMuted: helper.isMuted,
                isVisible: helper.isVisible,
            };
        }
        // Ak nebeží, pošleme default STOPPED
        return {
            ...site,
            status: STATUS.STOPPED,
            isMuted: false,
            isVisible: false,
        };
    });
});
ipcMain.handle("open-config", async () => shell.openPath(getConfigPath()));

ipcMain.handle("control-site", (_, { id, action }) => {
    const helper = helpers.get(id);

    // Štartovanie novej stránky
    if (action === COMMANDS.START) {
        const site = loadSites().find((s) => s.id === id);
        if (!helper && site) startHelper(site);
        return;
    }

    // Ak helper neexistuje alebo štartuje (a nechceme ho stopnúť), ignorujeme
    if (
        !helper ||
        (helper.status === STATUS.STARTING && action !== COMMANDS.STOP)
    )
        return;

    switch (action) {
        case COMMANDS.STOP:
            stopHelper(id, true);
            break;
        case COMMANDS.MUTE:
        case COMMANDS.UNMUTE:
        case COMMANDS.SHOW:
        case COMMANDS.HIDE:
        case COMMANDS.RELOAD:
            // Posielame príkaz priamo cez IPC objekt, nie cez stdin text
            sendCmd(helper, action);
            break;
    }
});

/* ================= HELPER CORE LOGIC ================= */

function startHelper(site, prevStats = {}) {
    if (helpers.has(site.id) && helpers.get(site.id).process) return;

    let scriptPath;
    if (app.isPackaged) {
        scriptPath = path.join(process.resourcesPath, "helpers", "helper.js");
        if (!fs.existsSync(scriptPath)) {
            scriptPath = path.join(
                process.resourcesPath,
                "app",
                "helpers",
                "helper.js"
            );
        }
    } else {
        scriptPath = path.join(app.getAppPath(), "helpers", "helper.js");
    }

    try {
        const args = [scriptPath, JSON.stringify(site)];
        if (app.isPackaged) args.unshift("--no-sandbox");

        // ZMENA: stdio nastavené na 'ipc' pre komunikáciu
        const child = spawn(process.execPath, args, {
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true,
        });

        const helper = {
            process: child,
            site,
            status: STATUS.STARTING,
            isMuted: prevStats.isMuted ?? false,
            isVisible: prevStats.isVisible ?? false,
            restarts: prevStats.restarts ?? 0,
            userStopped: false,
        };

        helpers.set(site.id, helper);
        notifyRenderer(helper);

        // ZMENA: Počúvame na 'message' event (Native Node IPC)
        child.on("message", (msg) => {
            handleHelperMessage(helper, msg);
        });

        child.on("exit", (code) => {
            console.log(`[${site.id}] Exit kód: ${code}`);
            helpers.delete(site.id);
            if (helper.userStopped) {
                notifyRenderer({ ...helper, status: STATUS.STOPPED });
            } else {
                notifyRenderer({ ...helper, status: STATUS.CRASHED });
                handleCrash(helper);
            }
        });
    } catch (e) {
        console.error(`[${site.id}] Spawn error:`, e);
    }
}

function handleHelperMessage(helper, msg) {
    if (!msg) return;

    // Helper posiela objekty alebo stringy, spracujeme oboje
    const command = typeof msg === "object" ? msg.cmd : msg;

    if (command === COMMANDS.HEARTBEAT) return;

    if (command === STATUS.RUNNING) {
        updateHelperState(helper, { status: STATUS.RUNNING });
        // Synchronizácia stavu po reštarte/štarte
        if (helper.isMuted) sendCmd(helper, COMMANDS.MUTE);
        if (!helper.isVisible) sendCmd(helper, COMMANDS.HIDE);
    } else if (command === STATUS.MUTED)
        updateHelperState(helper, { isMuted: true });
    else if (command === "unmuted")
        updateHelperState(helper, { isMuted: false });
    else if (command === "shown")
        updateHelperState(helper, { isVisible: true });
    else if (command === "hidden")
        updateHelperState(helper, { isVisible: false });
}

function updateHelperState(helper, changes) {
    Object.assign(helper, changes);
    notifyRenderer(helper);
}

function stopHelper(id, userInitiated = false) {
    const helper = helpers.get(id);
    if (helper) {
        helper.userStopped = userInitiated;
        helper.process.kill();
    }
}

function handleCrash(helper) {
    if (helper.restarts >= MAX_RESTARTS || helper.userStopped) return;
    helper.restarts++;
    setTimeout(() => startHelper(helper.site, helper), RESTART_DELAY);
}

function sendCmd(helper, cmd) {
    // ZMENA: Používame child.send() namiesto stdin.write()
    if (helper && helper.process && helper.process.connected) {
        helper.process.send(cmd);
    }
}

function notifyRenderer(helper) {
    if (win && !win.isDestroyed()) {
        win.webContents.send("site-status", {
            id: helper.site ? helper.site.id : helper.id,
            status: helper.status,
            isMuted: helper.isMuted,
            isVisible: helper.isVisible,
        });
    }
}

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

app.on("before-quit", () => {
    helpers.forEach((h) => h.process && h.process.kill());
});
