(() => {
    const els = {
        loadButton: document.getElementById("load-button"),
        loadInput: document.getElementById("load-input"),
        status: document.getElementById("status"),
        name: document.getElementById("name"),
        typeLocal: document.getElementById("type-local"),
        typeRemote: document.getElementById("type-remote"),
        remoteFields: document.getElementById("remote-fields"),
        url: document.getElementById("url"),
        autoUpdate: document.getElementById("auto-update"),
        intervalField: document.getElementById("interval-field"),
        interval: document.getElementById("interval"),
        config: document.getElementById("config"),
        saveButton: document.getElementById("save-button"),
    };

    function setStatus(text, kind = "info") {
        els.status.textContent = text;
        els.status.dataset.kind = kind;
    }

    const FIELD_IDS = ["name", "url", "interval", "config"];

    function setFieldError(fieldId, message) {
        const errEl = document.getElementById(fieldId + "-error");
        if (!errEl) return;
        if (message) {
            errEl.textContent = message;
            errEl.hidden = false;
        } else {
            errEl.textContent = "";
            errEl.hidden = true;
        }
    }

    function clearFieldErrors() {
        FIELD_IDS.forEach((id) => setFieldError(id, null));
    }

    FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", () => setFieldError(id, null));
    });

    function isRemoteSelected() {
        return els.typeRemote.checked;
    }

    function updateVisibility() {
        const remote = isRemoteSelected();
        els.remoteFields.hidden = !remote;
        els.intervalField.hidden = !(remote && els.autoUpdate.checked);
    }

    els.typeLocal.addEventListener("change", updateVisibility);
    els.typeRemote.addEventListener("change", updateVisibility);
    els.autoUpdate.addEventListener("change", updateVisibility);

    els.loadButton.addEventListener("click", () => els.loadInput.click());

    const MAX_FILE_SIZE = 16 * 1024 * 1024;
    const MiB = (bytes) => bytes / 1024 / 1024;

    async function loadFromFile(file) {
        const label = file.name || "profile";
        if (file.size > MAX_FILE_SIZE) {
            setStatus(`File is too large (${MiB(file.size).toFixed(1)} MiB, max ${MiB(MAX_FILE_SIZE)} MiB). This does not look like a .bpf profile.`, "error");
            return;
        }
        setStatus(`Loading ${label}…`);
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const profile = await BPF.decode(bytes);
            populateForm(profile);
            setStatus(`Loaded ${label}.`, "ok");
        } catch (err) {
            console.error(err);
            setStatus(`Failed to load: ${err.message}`, "error");
        }
    }

    els.loadInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            await loadFromFile(file);
        } finally {
            els.loadInput.value = "";
        }
    });

    document.addEventListener("paste", (e) => {
        const files = e.clipboardData && e.clipboardData.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        loadFromFile(files[0]);
    });

    function hasFiles(e) {
        return e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    }

    let dragDepth = 0;

    function resetDropState() {
        dragDepth = 0;
        document.body.classList.remove("dropping");
    }

    document.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (dragDepth++ === 0) document.body.classList.add("dropping");
    });

    document.addEventListener("dragover", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    document.addEventListener("dragleave", (e) => {
        if (!hasFiles(e)) return;
        if (--dragDepth <= 0) resetDropState();
    });

    document.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        resetDropState();
        const file = e.dataTransfer.files[0];
        if (file) loadFromFile(file);
    });

    document.addEventListener("dragend", resetDropState);
    window.addEventListener("blur", resetDropState);

    function populateForm(p) {
        clearFieldErrors();
        els.name.value = p.name || "";

        if (p.type === BPF.PROFILE_TYPE.REMOTE) {
            els.typeRemote.checked = true;
        } else {
            els.typeLocal.checked = true;
        }

        els.url.value = p.remotePath || "";
        els.autoUpdate.checked = !!p.autoUpdate;
        els.interval.value = p.autoUpdateInterval;
        els.config.value = p.config || "";

        updateVisibility();
    }

    els.saveButton.addEventListener("click", async () => {
        const profile = collectForm();
        if (!profile) return;

        try {
            const bytes = await BPF.encode(profile);
            const filename = sanitizeFilename(profile.name) + ".bpf";
            triggerDownload(bytes, filename);
            setStatus(`Saved as ${filename}.`, "ok");
        } catch (err) {
            console.error(err);
            setStatus(`Failed to save: ${err.message}`, "error");
        }
    });

    const NAME_MAX_LENGTH = 256;
    const INTERVAL_MIN = 15;
    const INTERVAL_MAX = 7 * 24 * 60;

    function collectForm() {
        clearFieldErrors();

        const name = els.name.value.trim();
        if (!name) {
            setFieldError("name", "Name is required.");
            els.name.focus();
            return null;
        }
        if (name.length > NAME_MAX_LENGTH) {
            setFieldError("name", `Name is too long (max ${NAME_MAX_LENGTH} characters).`);
            els.name.focus();
            return null;
        }
        if (name.includes("\x00")) {
            setFieldError("name", "Name must not contain NUL characters.");
            els.name.focus();
            return null;
        }

        const type = isRemoteSelected() ? BPF.PROFILE_TYPE.REMOTE : BPF.PROFILE_TYPE.LOCAL;
        const config = els.config.value;
        if (!config.trim()) {
            setFieldError("config", "Config must not be empty.");
            els.config.focus();
            return null;
        }

        const profile = {
            name,
            type,
            config,
            remotePath: "",
            autoUpdate: false,
            autoUpdateInterval: 0,
        };

        if (type === BPF.PROFILE_TYPE.REMOTE) {
            const url = els.url.value.trim();
            if (!url) {
                setFieldError("url", "URL is required for remote profiles.");
                els.url.focus();
                return null;
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                setFieldError("url", "URL is not valid.");
                els.url.focus();
                return null;
            }
            if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
                setFieldError("url", "URL must use http:// or https://.");
                els.url.focus();
                return null;
            }
            profile.remotePath = url;
            profile.autoUpdate = els.autoUpdate.checked;

            const interval = parseInt(els.interval.value, 10);
            if (profile.autoUpdate) {
                if (!Number.isFinite(interval) || interval < INTERVAL_MIN) {
                    setFieldError("interval", `Auto-update interval must be at least ${INTERVAL_MIN} minutes.`);
                    els.interval.focus();
                    return null;
                }
                if (interval > INTERVAL_MAX) {
                    setFieldError("interval", `Auto-update interval is too large (max 1 week = ${INTERVAL_MAX} minutes).`);
                    els.interval.focus();
                    return null;
                }
                profile.autoUpdateInterval = interval;
            } else {
                const safe = Number.isFinite(interval) ? interval : 0;
                profile.autoUpdateInterval = Math.min(Math.max(safe, 0), INTERVAL_MAX);
            }
        }

        return profile;
    }

    function sanitizeFilename(name) {
        const cleaned = name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_").trim();
        return cleaned || "profile";
    }

    function triggerDownload(bytes, filename) {
        const blob = new Blob([bytes], {type: "application/octet-stream"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    updateVisibility();
})();
