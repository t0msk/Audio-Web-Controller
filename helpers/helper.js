"use strict";

const { app, BrowserWindow, powerSaveBlocker } = require("electron");
const path = require("path");
const { STATUS, COMMANDS } = require("../controller/constants"); // Uisti sa, že cesta sedí

if (!process.argv[2]) process.exit(1);
const site = JSON.parse(process.argv[2]);

app.setAppUserModelId(`com.audio.helper.${site.id}`);
const defaultUserData = app.getPath("userData");
const customUserData = path.join(defaultUserData, "sessions", site.id);
app.setPath("userData", customUserData);

app.name = `Audio Helper - ${site.name}`;
process.title = `audio-helper-${site.id}`;

console.log(`[${site.id}] UserData path: ${app.getPath("userData")}`);

let win = null;
let heartbeatInterval = null;

function send(msg) {
    // Ak už nemáme kam písať, nebudeme sa o to ani pokúšať
    if (!process.stdout.writable) return;

    try {
        process.stdout.write(msg + "\n", (err) => {
            if (err && err.code === "EPIPE") {
                // Ak zistíme Broken Pipe, radšej ukončíme helper,
                // lebo to znamená, že Controller je mŕtvy.
                process.exit(0);
            }
        });
    } catch (e) {
        // Ignorujeme chybu, proces sa pravdepodobne ukončuje
    }
}

function createWindow() {
    win = new BrowserWindow({
        title: site.name,
        show: false,
        width: 300,
        height: 300,
        webPreferences: {
            backgroundThrottling: false,
            offscreen: false,
        },
    });

    win.loadURL(site.url);

    win.webContents.on("page-title-updated", (e) => e.preventDefault());

    win.webContents.on("did-finish-load", () => {
        // Keď sa stránka načíta (aj po reloade), pošleme RUNNING
        send(STATUS.RUNNING);
    });

    win.webContents.on("render-process-gone", () => process.exit(1));

    // Audio Keep-alive hack
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript("void 0").catch(() => {});
        }
    }, 15000);
}

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
            send("unmuted"); // Dôležité: Potvrdenie pre Main process
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
            // Pri reloade sa status zmení na RUNNING až cez event did-finish-load
            win.webContents.reload();
            break;
    }
});

app.whenReady().then(() => {
    powerSaveBlocker.start("prevent-app-suspension");
    createWindow();
    heartbeatInterval = setInterval(() => send(COMMANDS.HEARTBEAT), 5000);

    process.stdin.on("close", () => {
        app.quit();
    });

    process.stdin.on("error", () => {
        app.quit();
    });
});
