"use strict";

const { app, BrowserWindow, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");

// Načítanie konštánt relatívne k umiestneniu helper.js
const { STATUS, COMMANDS } = require(path.join(
    __dirname,
    "..",
    "controller",
    "constants.js"
));

// Logovanie do súboru pre diagnostiku na Windowse
const debugLog = (m) => {
    try {
        const logPath = path.join(app.getPath("userData"), "helper-debug.log");
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${m}\n`);
    } catch (e) {}
};

debugLog("--- Helper Process Initializing ---");

if (!process.argv[2]) {
    debugLog("Fatal: No site data received.");
    process.exit(1);
}

const site = JSON.parse(process.argv[2]);

// Konfigurácia Electron prostredia pre konkrétnu stránku
try {
    app.name = `AudioHelper-${site.id}`;
    const sessionPath = path.join(app.getPath("userData"), "sessions", site.id);
    app.setPath("userData", sessionPath);
    app.setAppUserModelId(`com.audio.helper.${site.id}`);
} catch (e) {
    debugLog(`Config Error: ${e.message}`);
}

// FIX: Vynútenie okamžitého posielania správ cez stdout na Windowse
if (process.stdout._handle && process.stdout._handle.setBlocking) {
    process.stdout._handle.setBlocking(true);
}

let win = null;

function send(msg) {
    if (!process.stdout.writable) return;
    try {
        process.stdout.write(msg + "\n");
    } catch (e) {
        debugLog(`Send error: ${e.message}`);
    }
}

function createWindow() {
    win = new BrowserWindow({
        title: site.name,
        show: false, // Vždy začína skryté
        width: 600,
        height: 300,
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

    // Audio Keep-alive trik (bráni uspatiu karty)
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript("void 0").catch(() => {});
        }
    }, 15000);
}

// Spracovanie príkazov z Main procesu
process.stdin.on("data", (data) => {
    const cmd = data.toString().trim();
    if (!win || win.isDestroyed()) return;

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
            win.webContents.reload();
            break;
    }
});

app.whenReady()
    .then(() => {
        debugLog("Helper App Ready.");
        powerSaveBlocker.start("prevent-app-suspension");
        createWindow();

        // Heartbeat pre kontrolu stability
        setInterval(() => send(COMMANDS.HEARTBEAT), 5000);

        // Ak sa preruší spojenie s ovládačom, vypni sa
        process.stdin.on("close", () => app.quit());
    })
    .catch((err) => {
        debugLog(`App Boot Error: ${err.message}`);
    });
