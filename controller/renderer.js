// Konštanty (v produkcii by boli importované alebo cez preload)
const STATUS = {
    STARTING: "starting",
    RUNNING: "running",
    MUTED: "muted",
    STOPPED: "stopped",
    CRASHED: "crashed",
};
const COMMANDS = {
    START: "start",
    STOP: "stop",
    MUTE: "mute",
    UNMUTE: "unmute",
    SHOW: "show",
    HIDE: "hide",
    RELOAD: "reload",
};

const list = document.getElementById("list");

async function init() {
    const sites = await window.api.getSites();
    list.innerHTML = "";

    sites.forEach((site) => {
        list.appendChild(createRow(site));
        // Default init state
        updateRow({
            id: site.id,
            status: STATUS.STOPPED,
            isMuted: false,
            isVisible: false,
        });
    });

    // Prijímame KOMPLETNÝ stavový objekt
    window.api.onStatusChange((fullState) => {
        updateRow(fullState);
    });
}

function createRow(site) {
    const tr = document.createElement("tr");
    tr.id = `row-${site.id}`;
    tr.innerHTML = `
        <td>${site.name}</td>
        <td class="status-cell">PENDING</td>
        <td class="actions">
            <button data-act="${COMMANDS.START}">Start</button>
            <button data-act="${COMMANDS.STOP}">Stop</button>
            <button data-act="toggle-mute">Mute</button>
            <button data-act="toggle-ui">Show UI</button>
            <button data-act="${COMMANDS.RELOAD}">Reload</button>
        </td>
    `;
    tr.querySelector(".actions").addEventListener("click", (e) =>
        handleAction(e, site.id)
    );
    return tr;
}

// Toto je mozog UI - už žiadne hádanie
function updateRow({ id, status, isMuted, isVisible }) {
    const tr = document.getElementById(`row-${id}`);
    if (!tr) return;

    // 1. Uloženie stavu do DOM (pre istotu)
    tr.dataset.status = status;

    // 2. Vizuál statusu
    const statusCell = tr.querySelector(".status-cell");
    let displayStatus = status.toUpperCase();
    if (status === STATUS.RUNNING && isMuted) displayStatus = "MUTED"; // Muted je len sub-stav pre užívateľa

    statusCell.textContent = displayStatus;
    statusCell.className = `status-cell status-${status}`;
    if (isMuted) statusCell.classList.add("status-muted");

    // 3. Získanie tlačidiel
    const btnStart = tr.querySelector(`[data-act="${COMMANDS.START}"]`);
    const btnStop = tr.querySelector(`[data-act="${COMMANDS.STOP}"]`);
    const btnMute = tr.querySelector(`[data-act="toggle-mute"]`);
    const btnUi = tr.querySelector(`[data-act="toggle-ui"]`);
    const btnReload = tr.querySelector(`[data-act="${COMMANDS.RELOAD}"]`);

    // 4. Logika Enable/Disable
    const isRunning = status === STATUS.RUNNING;
    const isStarting = status === STATUS.STARTING;

    // Defaultne všetko povolíme, potom zakazujeme
    [btnStart, btnStop, btnMute, btnUi, btnReload].forEach(
        (b) => (b.disabled = false)
    );

    if (status === STATUS.STOPPED || status === STATUS.CRASHED) {
        btnStart.hidden = false;
        btnStop.hidden = true;

        btnMute.disabled = true;
        btnUi.disabled = true;
        btnReload.disabled = true;

        // Reset textov
        btnMute.textContent = "Mute";
        btnUi.textContent = "Show UI";
    } else if (isStarting) {
        // Počas štartovania/reloadu všetko zakážeme, aby user neklikal 2x
        btnStart.disabled = true;
        btnStop.disabled = false; // Stop povolíme, ak by to zamrzlo
        btnMute.disabled = true;
        btnUi.disabled = true;
        btnReload.disabled = true;

        btnStart.hidden = true;
        btnStop.hidden = false;
    } else {
        // RUNNING
        btnStart.hidden = true;
        btnStop.hidden = false;

        // OPRAVA BUGU UNMUTE: Text a príkaz sa menia podľa isMuted flagu z backendu
        if (isMuted) {
            btnMute.textContent = "Unmute";
            btnMute.dataset.cmd = COMMANDS.UNMUTE;
        } else {
            btnMute.textContent = "Mute";
            btnMute.dataset.cmd = COMMANDS.MUTE;
        }

        // OPRAVA BUGU HIDE UI: Text a príkaz sa menia podľa isVisible flagu z backendu
        if (isVisible) {
            btnUi.textContent = "Hide UI";
            btnUi.dataset.cmd = COMMANDS.HIDE;
        } else {
            btnUi.textContent = "Show UI";
            btnUi.dataset.cmd = COMMANDS.SHOW;
        }
    }
}

async function handleAction(e, id) {
    if (e.target.tagName !== "BUTTON") return;
    const btn = e.target;

    // Okamžitá vizuálna odozva - zakáž tlačidlo
    btn.disabled = true;

    let action = btn.dataset.act;

    // Resolve toggle commands
    if (action === "toggle-mute" || action === "toggle-ui") {
        action = btn.dataset.cmd;
    }

    // Pošleme príkaz
    await window.api.control(id, action);

    // Poznámka: Tlačidlo neodomykáme tu. Odomkne sa automaticky,
    // keď príde "site-status" event z Main processu.
}

document
    .getElementById("open-config")
    .addEventListener("click", () => window.api.openConfig());
init();
