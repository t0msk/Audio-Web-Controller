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
    // Teraz 'sites' obsahuje už aj aktuálny status (STARTING/RUNNING...)
    const sites = await window.api.getSites();
    list.innerHTML = "";

    sites.forEach((site) => {
        list.appendChild(createRow(site));

        // OPRAVA: Okamžitý update UI podľa reálneho stavu z main processu
        // (Už žiadne manuálne nastavovanie na STOPPED)
        updateRow(site);
    });

    window.api.onStatusChange((fullState) => {
        updateRow(fullState);
    });
}

function createRow(site) {
    const tr = document.createElement("tr");
    tr.id = `row-${site.id}`;

    // FIX PRE SHOW UI: Pridané data-cmd="show" ako predvolená hodnota
    tr.innerHTML = `
        <td>${site.name}</td>
        <td class="status-cell">PENDING</td>
        <td class="actions">
            <button data-act="${COMMANDS.START}">Start</button>
            <button data-act="${COMMANDS.STOP}">Stop</button>
            <button data-act="toggle-mute" data-cmd="${COMMANDS.MUTE}">Mute</button>
            <button data-act="toggle-ui" data-cmd="${COMMANDS.SHOW}">Show UI</button>
            <button data-act="${COMMANDS.RELOAD}">Reload</button>
        </td>
    `;
    tr.querySelector(".actions").addEventListener("click", (e) =>
        handleAction(e, site.id)
    );
    return tr;
}

function updateRow({ id, status, isMuted, isVisible }) {
    const tr = document.getElementById(`row-${id}`);
    if (!tr) return;

    tr.dataset.status = status;

    const statusCell = tr.querySelector(".status-cell");
    let displayStatus = status.toUpperCase();
    if (status === STATUS.RUNNING && isMuted) displayStatus = "MUTED";

    statusCell.textContent = displayStatus;
    statusCell.className = `status-cell status-${status}`;
    if (isMuted) statusCell.classList.add("status-muted");

    const btnStart = tr.querySelector(`[data-act="${COMMANDS.START}"]`);
    const btnStop = tr.querySelector(`[data-act="${COMMANDS.STOP}"]`);
    const btnMute = tr.querySelector(`[data-act="toggle-mute"]`);
    const btnUi = tr.querySelector(`[data-act="toggle-ui"]`);
    const btnReload = tr.querySelector(`[data-act="${COMMANDS.RELOAD}"]`);

    [btnStart, btnStop, btnMute, btnUi, btnReload].forEach(
        (b) => (b.disabled = false)
    );

    if (status === STATUS.STOPPED || status === STATUS.CRASHED) {
        btnStart.hidden = false;
        btnStop.hidden = true;
        btnMute.disabled = true;
        btnUi.disabled = true;
        btnReload.disabled = true;

        // Reset stavu tlačidiel
        btnUi.textContent = "Show UI";
        btnUi.dataset.cmd = COMMANDS.SHOW;
        btnMute.textContent = "Mute";
        btnMute.dataset.cmd = COMMANDS.MUTE;
    } else if (status === STATUS.STARTING) {
        // V tomto stave vidíš oranžovú farbu a točí sa to
        btnStart.disabled = true;
        btnStop.disabled = false; // Stop povolený
        btnMute.disabled = true;
        btnUi.disabled = true;
        btnReload.disabled = true;

        btnStart.hidden = true;
        btnStop.hidden = false;
    } else {
        // RUNNING
        btnStart.hidden = true;
        btnStop.hidden = false;

        if (isMuted) {
            btnMute.textContent = "Unmute";
            btnMute.dataset.cmd = COMMANDS.UNMUTE;
        } else {
            btnMute.textContent = "Mute";
            btnMute.dataset.cmd = COMMANDS.MUTE;
        }

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
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;

    btn.disabled = true;

    // Získame základnú akciu (start, stop, reload, toggle-ui, toggle-mute)
    let action = btn.dataset.act;

    // Logika pre Toggle tlačidlá - rozhodujeme sa podľa TEXTU na tlačidle
    // To zaručí, že ak vidíš "Show UI", pošle sa príkaz "show" bez ohľadu na dataset
    if (action === "toggle-ui") {
        const text = btn.textContent.toLowerCase();
        action = text.includes("show") ? COMMANDS.SHOW : COMMANDS.HIDE;
    } else if (action === "toggle-mute") {
        const text = btn.textContent.toLowerCase();
        action =
            text.includes("mute") && !text.includes("unmute")
                ? COMMANDS.MUTE
                : COMMANDS.UNMUTE;
    }

    console.log(`[Client] Clicking ${btn.textContent} -> Sending: ${action}`);

    try {
        await window.api.control(id, action);
    } catch (err) {
        console.error("Control failed", err);
        btn.disabled = false;
    }
}

document
    .getElementById("open-config")
    .addEventListener("click", () => window.api.openConfig());
init();
