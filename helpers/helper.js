("use strict");

const { app, BrowserWindow, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");

const { STATUS, COMMANDS } = require(path.join(
    __dirname,
    "..",
    "controller",
    "constants.js"
));

// Diagnostický log
const debugLog = (m) => {
    try {
        const logPath = path.join(app.getPath("userData"), "helper-debug.log");
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${m}\n`);
    } catch (e) {}
};

debugLog("--- Helper Process Initializing (IPC Mode) ---");

if (!process.argv[2]) {
    debugLog("Fatal: No site data received.");
    process.exit(1);
}

let site;
try {
    site = JSON.parse(process.argv[2]);
} catch (e) {
    debugLog(`JSON Parse Error: ${process.argv[2]}`);
    process.exit(1);
}

// Konfigurácia ciest
try {
    app.name = `AudioHelper-${site.id}`;
    const sessionPath = path.join(app.getPath("userData"), "sessions", site.id);
    app.setPath("userData", sessionPath);
    app.setAppUserModelId(`com.audio.helper.${site.id}`);
} catch (e) {
    debugLog(`Config Error: ${e.message}`);
}

let win = null;

function send(msg) {
    if (process.send) {
        process.send(msg);
    }
}

function createWindow() {
    win = new BrowserWindow({
        title: site.name,
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required",
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.loadURL(site.url);

    win.webContents.on("did-finish-load", () => {
        send(STATUS.RUNNING);
    });

    // FIX ZOMBIE PROCESOV: Ak sa okno zatvorí (napr. krížikom),
    // musíme okamžite zabiť celý tento helper proces.
    win.on("closed", () => {
        debugLog("Window closed by user or system -> Quitting Helper.");
        app.quit();
    });

    // Keep-alive
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript("void 0").catch(() => {});
        }
    }, 15000);
}

process.on("message", (cmd) => {
    if (!win || win.isDestroyed()) return;

    // debugLog(`Received command: ${cmd}`);

    switch (cmd) {
        case COMMANDS.MUTE:
            win.webContents.setAudioMuted(true);
            send(STATUS.MUTED);
            break;
        case COMMANDS.UNMUTE:
            win.webContents.setAudioMuted(false);
            send("unmuted");
            break;
        case COMMANDS.SHOW:
            win.show();
            win.focus(); // FIX: Vynútenie popredia na Windowse
            send("shown");
            break;
        case COMMANDS.HIDE:
            win.hide();
            send("hidden");
            break;
        case COMMANDS.RELOAD:
            win.webContents.reload();
            break;
    }
});

app.whenReady()
    .then(() => {
        powerSaveBlocker.start("prevent-app-suspension");
        createWindow();

        setInterval(() => send(COMMANDS.HEARTBEAT), 5000);

        process.on("disconnect", () => {
            app.quit();
        });
    })
    .catch((err) => {
        debugLog(`App Boot Error: ${err.message}`);
    });
