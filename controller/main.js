const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { STATUS, COMMANDS } = require("./constants");

/* ================= PROD / WINDOWS BOOT LOGIC ================= */

const isHelper = process.argv.some((arg) =>
    arg.toLowerCase().includes("helper.js")
);

if (isHelper) {
    // AK SME HELPER, TU KONČÍME.
    // Electron sám spracuje helper.js z argumentov.
    return;
}

// Single Instance Lock len pre Controller
if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

setupMainApp();

function setupMainApp() {
    app.setAppUserModelId("com.audio.controller");

    const MAX_RESTARTS = 5;
    const RESTART_DELAY = 3000;
    const CONFIG_NAME = "sites.json";

    let win;
    const helpers = new Map();

    /* ================= CONFIG ================= */

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

    ipcMain.handle("get-sites", () => loadSites());
    ipcMain.handle("open-config", async () => shell.openPath(getConfigPath()));

    ipcMain.handle("control-site", (_, { id, action }) => {
        const helper = helpers.get(id);
        if (action === COMMANDS.START) {
            const sites = loadSites();
            const siteConfig = sites.find((s) => s.id === id);
            if (!helper && siteConfig) startHelper(siteConfig);
            return;
        }

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
                updateHelperState(helper, { status: STATUS.STARTING });
                sendCmd(helper, COMMANDS.RELOAD);
                break;
        }
    });

    /* ================= HELPER LOGIC ================= */

    function startHelper(site, prevStats = {}) {
        if (helpers.has(site.id) && helpers.get(site.id).process) return;

        let scriptPath = path.join(__dirname, "..", "helpers", "helper.js");
        if (
            scriptPath.includes("app.asar") &&
            !scriptPath.includes("app.asar.unpacked")
        ) {
            scriptPath = scriptPath.replace("app.asar", "app.asar.unpacked");
        }

        try {
            // ZMENA: Na Windowse v produkcii pridáme argumenty, ktoré Electronu
            // vynútia spustenie skriptu
            const args = [scriptPath, JSON.stringify(site)];

            // Ak sme v produkcii, Electron niekedy vyžaduje tieto flagy pre stabilitu
            if (app.isPackaged) {
                args.unshift("--no-sandbox");
            }

            const child = spawn(process.execPath, args, {
                stdio: ["pipe", "pipe", "pipe"],
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: undefined, // Musí byť undefined, aby fungovalo BrowserWindow
                },
            });

            // PRIDAJ TENTO LOG: Zistíme, či proces vôbec odštartoval
            console.log(`[${site.id}] PID procesu: ${child.pid}`);

            if (!child.pid) {
                console.error(
                    `[${site.id}] Proces sa nepodarilo spustiť (žiadne PID).`
                );
                return;
            }

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

            child.stdout.on("data", (data) => {
                data.toString()
                    .split("\n")
                    .forEach((m) => handleHelperMessage(helper, m.trim()));
            });

            child.stderr.on("data", (data) =>
                console.error(`[${site.id}] Err:`, data.toString())
            );

            child.on("exit", (code) => {
                console.log(`[${site.id}] Exit code: ${code}`);
                helpers.delete(site.id);
                if (helper.userStopped) {
                    notifyRenderer({ ...helper, status: STATUS.STOPPED });
                } else {
                    notifyRenderer({ ...helper, status: STATUS.CRASHED });
                    handleCrash(helper);
                }
            });

            child.on("error", (err) => {
                console.error(`[${site.id}] Spawn error:`, err);
                notifyRenderer({ ...site, status: STATUS.CRASHED });
            });
        } catch (e) {
            console.error(`[${site.id}] Critical spawn error:`, e);
        }
    }

    function handleHelperMessage(helper, msg) {
        if (!msg) return;
        if (msg === COMMANDS.HEARTBEAT) return;

        if (msg === STATUS.RUNNING) {
            updateHelperState(helper, { status: STATUS.RUNNING });
            if (helper.isMuted) sendCmd(helper, COMMANDS.MUTE);
            if (!helper.isVisible) sendCmd(helper, COMMANDS.HIDE);
        } else if (msg === STATUS.MUTED)
            updateHelperState(helper, { isMuted: true });
        else if (msg === "unmuted")
            updateHelperState(helper, { isMuted: false });
        else if (msg === "shown")
            updateHelperState(helper, { isVisible: true });
        else if (msg === "hidden")
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
        if (helper.restarts >= MAX_RESTARTS) return;
        helper.restarts++;
        setTimeout(() => {
            if (!helper.userStopped) startHelper(helper.site, helper);
        }, RESTART_DELAY);
    }

    function sendCmd(helper, cmd) {
        if (helper?.process?.stdin?.writable)
            helper.process.stdin.write(cmd + "\n");
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
}
