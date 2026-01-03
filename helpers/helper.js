"use strict";

const { app, BrowserWindow, powerSaveBlocker } = require("electron");
const path = require("path");
// Uprav si cestu k constants podľa tvojej štruktúry
const { STATUS, COMMANDS } = require("../controller/constants");

const fs = require("fs");
const logPath = path.join(app.getPath("userData"), "helper-debug.log");
const log = (m) =>
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${m}\n`);

log("--- Helper Session Start ---");

if (!process.argv[2]) {
    log("Error: No arguments received.");
    process.exit(1);
}

const site = JSON.parse(process.argv[2]);
log(`Site: ${site.id}`);

// Nastavenie ciest a názvu procesu
try {
    app.name = "AudioHelper";
    app.setAppUserModelId(`com.audio.helper.${site.id}`);
    const customPath = path.join(app.getPath("userData"), "sessions", site.id);
    app.setPath("userData", customPath);
    log(`UserData: ${customPath}`);
} catch (e) {
    log(`Path Error: ${e.message}`);
}

// FIX: Vynútenie okamžitého zápisu do stdout (dôležité pre Windows)
if (process.stdout._handle && process.stdout._handle.setBlocking) {
    process.stdout._handle.setBlocking(true);
}

let win = null;

function send(msg) {
    if (!process.stdout.writable) return;
    try {
        process.stdout.write(msg + "\n");
    } catch (e) {
        log(`Pipe Error: ${e.message}`);
    }
}

function createWindow() {
    win = new BrowserWindow({
        title: site.name,
        show: false, // Štartujeme skryté
        width: 800,
        height: 600,
        webPreferences: {
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required",
        },
    });

    win.loadURL(site.url);

    win.webContents.on("did-finish-load", () => {
        send(STATUS.RUNNING);
    });

    win.webContents.on("render-process-gone", () => {
        log("Render process crashed.");
        process.exit(1);
    });
}

// Príkazy z Main procesu
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
        log("App ready.");
        powerSaveBlocker.start("prevent-app-suspension");

        createWindow();

        // Heartbeat komunikácia
        setInterval(() => send(COMMANDS.HEARTBEAT), 5000);

        // Ak sa zavrie komunikačný kanál, helper sa musí vypnúť
        process.stdin.on("close", () => app.quit());
        process.stdin.on("error", () => app.quit());
    })
    .catch((err) => {
        log(`Boot Error: ${err.message}`);
    });
