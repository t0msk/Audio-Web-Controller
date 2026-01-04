"use strict";

const { app, BrowserWindow, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");

const { STATUS, COMMANDS } = require(path.join(
    __dirname,
    "..",
    "controller",
    "constants.js"
));

// Logovanie pre diagnostiku
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

try {
    app.name = `AudioHelper-${site.id}`;
    const sessionPath = path.join(app.getPath("userData"), "sessions", site.id);
    app.setPath("userData", sessionPath);
    app.setAppUserModelId(`com.audio.helper.${site.id}`);
} catch (e) {
    debugLog(`Config Error: ${e.message}`);
}

let win = null;

// ZMENA: Funkcia na odosielanie správ cez IPC
function send(msg) {
    if (process.send) {
        process.send(msg);
    } else {
        debugLog("IPC channel not available!");
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

    // Keep-alive
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript("void 0").catch(() => {});
        }
    }, 15000);
}

// ZMENA: Spracovanie príkazov cez IPC (namiesto stdin)
process.on("message", (cmd) => {
    if (!win || win.isDestroyed()) return;

    debugLog(`Received command: ${cmd}`);

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
            send("shown");
            break;
        case COMMANDS.HIDE:
            win.hide();
            send("hidden");
            break;
        case COMMANDS.RELOAD:
            // Pri reloade pošleme status STARTING, aby UI vedelo
            // (aj keď hlavný proces to rieši, je dobré to potvrdiť)
            win.webContents.reload();
            break;
    }
});

app.whenReady()
    .then(() => {
        debugLog("Helper App Ready.");
        powerSaveBlocker.start("prevent-app-suspension");
        createWindow();

        setInterval(() => send(COMMANDS.HEARTBEAT), 5000);

        // Ak sa preruší spojenie s rodičom (main process spadne/vypne sa)
        process.on("disconnect", () => {
            debugLog("Parent disconnected, quitting...");
            app.quit();
        });
    })
    .catch((err) => {
        debugLog(`App Boot Error: ${err.message}`);
    });
