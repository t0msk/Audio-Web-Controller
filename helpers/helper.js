("use strict");

const { app, BrowserWindow, powerSaveBlocker, shell } = require("electron");
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

function isGoogleAuth(url) {
    return (
        url.startsWith("https://accounts.google.com") ||
        url.includes("accounts.google.com/o/oauth2") ||
        url.includes("oauth2") ||
        url.includes("ServiceLogin")
    );
}

function createWindow() {
    site.name = "AWC Helper: " + site.name;

    win = new BrowserWindow({
        title: site.name,
        show: false,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        type: "utility",
        webPreferences: {
            plugins: true,
            webSecurity: true,
            enableWidevine: process.platform === "win32",
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required",
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const userAgent =
        process.platform === "win32"
            ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    win.webContents.setUserAgent(userAgent);

    //win.setPosition(-10000, -10000);
    win.setOpacity(0.0);

    win.loadURL(site.url);

    win.webContents.on("did-finish-load", () => {
        send(STATUS.RUNNING);
        ghostMode(true);
    });

    win.webContents.on("will-navigate", (event, url) => {
        if (isGoogleAuth(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isGoogleAuth(url)) {
            shell.openExternal(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });

    // FIX ZOMBIE PROCESOV: Ak sa okno zatvorí (napr. krížikom),
    // musíme okamžite zabiť celý tento helper proces.
    win.on("closed", () => {
        debugLog("Window closed by user or system -> Quitting Helper.");
        app.quit();
    });

    win.on("page-title-updated", (event, title) => {
        event.preventDefault();
        win.setTitle(site.name);
    });

    // Keep-alive
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript("void 0").catch(() => {});
        }
    }, 15000);
}

// Funkcia pre Ghost logiku (lightweight mode)
function ghostMode(enable) {
    if (!win || win.isDestroyed()) return;

    win.show();

    if (enable) {
        // GHOST ON: Minimalizujeme záťaž, ale ostávame "viditeľní" pre OBS
        win.setAlwaysOnTop(true, "screen-saver");
        win.setIgnoreMouseEvents(true, { forward: true });
        win.setFocusable(false);
        win.setSkipTaskbar(true);
        win.setResizable(false);
        win.setMaximizable(false);
        win.setMinimizable(false);
        win.setFullScreenable(false);

        win.setOpacity(0.0);
        win.setSize(100, 100);
        //win.setPosition(-10000, -10000);

        win.hasShadow = false;
        win.autoHideMenuBar = true;
        win.webContents.setBackgroundThrottling(false);
        win.webContents.executeJavaScript(
            "document.querySelectorAll('video').forEach(v => v.style.display = 'none')"
        );
        send("hidden");
    } else {
        // 1. Zrušíme Always On Top a ignorovanie myši
        win.setAlwaysOnTop(false);
        win.setIgnoreMouseEvents(false);

        // 2. Aktivujeme ovládacie prvky okna (Window Bar tlačidlá)
        win.setFocusable(true);
        win.setResizable(true);
        win.setMaximizable(true);
        win.setMinimizable(true);
        win.setFullScreenable(true);

        // 3. Vizuálne nastavenia
        win.setSkipTaskbar(false);
        win.setOpacity(1.0);
        win.hasShadow = true;
        win.autoHideMenuBar = false;

        // 4. Pozícia a zobrazenie
        win.setSize(1024, 768); // Lepšie ako 800x600 pre moderné weby
        win.center();
        win.show();
        win.focus();
        win.moveTop();
        win.webContents.focus();

        win.webContents.setBackgroundThrottling(false);
        win.webContents.executeJavaScript(
            "document.querySelectorAll('video').forEach(v => v.style.display = 'block')"
        );
        send("shown");
    }
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
            ghostMode(false);
            send("shown");
            break;
        case COMMANDS.HIDE:
            ghostMode(true);
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
