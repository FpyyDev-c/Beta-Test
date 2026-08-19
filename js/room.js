/**
 * ScreenRoom — UI da sala, conectando a interface ao SRMesh.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const cfg = window.SR_CONFIG;

  const params = new URLSearchParams(location.search);
  const code = (params.get("code") || "").toUpperCase();

  if (!SR.isValidRoomCode(code)) {
    location.href = `index.html?error=invalid-code`;
    return;
  }

  const issues = SR.detectBrowserSupport();
  if (issues.length) {
    showFatal("Navegador incompatível", issues[0] + " Tente usar Chrome, Edge ou Firefox atualizados.");
  }

  let role = sessionStorage.getItem("screenroom:role");
  sessionStorage.removeItem("screenroom:role");
  let name = SR.getSavedName();

  // Acesso direto (sem passar pela landing): pede nome na hora.
  function ensureNameThenBoot() {
    if (name) return boot();
    const modal = $("#nameModal");
    const input = $("#nameInput");
    const hint = $("#nameHint");
    hint.textContent = `Você vai entrar na sala ${code}.`;
    modal.classList.add("open");
    setTimeout(() => input.focus(), 50);
    $("#nameConfirm").addEventListener("click", () => {
      if (!input.value.trim()) return;
      name = input.value.trim();
      SR.saveName(name);
      modal.classList.remove("open");
      role = role || "guest";
      boot();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#nameConfirm").click();
    });
  }

  // ---- Elementos ----
  const stage = $("#stage");
  const stageVideo = $("#stageVideo");
  const stageEmpty = $("#stageEmpty");
  const onAirBadge = $("#onAirBadge");
  const stageNameBadge = $("#stageNameBadge");
  const shareThumbs = $("#shareThumbs");
  const participantList = $("#participantList");
  const chatMsgs = $("#chatMsgs");
  const chatForm = $("#chatForm");
  const chatInput = $("#chatInput");
  const statusPill = $("#statusPill");
  const roomCodeChip = $("#roomCodeChip");
  const roomCodeText = $("#roomCodeText");
  const toastWrap = $("#toastWrap");

  const btnMic = $("#btnMic");
  const btnDeafen = $("#btnDeafen");
  const btnCamera = $("#btnCamera");
  const btnShare = $("#btnShare");
  const btnChatToggle = $("#btnChatToggle");
  const btnFullscreen = $("#btnFullscreen");
  const btnLeave = $("#btnLeave");
  const btnQuality = $("#btnQuality");
  const qualityMenu = $("#qualityMenu");
  const btnEndRoom = $("#btnEndRoom");
  const cameraStrip = $("#cameraStrip");

  // ---- Configurações de voz/vídeo ----
  const btnSettings = $("#btnSettings");
  const btnSettingsClose = $("#btnSettingsClose");
  const settingsModal = $("#settingsModal");
  const selMic = $("#selMic");
  const selCamera = $("#selCamera");
  const selCameraQuality = $("#selCameraQuality");
  const selSpeaker = $("#selSpeaker");
  const speakerSelectHint = $("#speakerSelectHint");
  const btnRefreshDevices = $("#btnRefreshDevices");
  const rangeMicVolume = $("#rangeMicVolume");
  const micVolumeLabel = $("#micVolumeLabel");
  const toggleEcho = $("#toggleEcho");
  const toggleNoiseSup = $("#toggleNoiseSup");
  const toggleAGC = $("#toggleAGC");
  const toggleIsolation = $("#toggleIsolation");
  const btnMicTest = $("#btnMicTest");
  const rangeScreenVolume = $("#rangeScreenVolume");
  const screenVolumeLabel = $("#screenVolumeLabel");
  const volumeList = $("#volumeList");

  roomCodeText.textContent = code;

  // ---- Estado local de UI ----
  let mesh = null;
  let currentMainSharer = null; // peerId sendo exibido no stage
  let selectedQuality = cfg.DEFAULT_QUALITY;
  let unreadChat = 0;
  const remoteScreens = new Map(); // peerId -> stream crua (usada nas miniaturas, sempre mudas)
  const screenChannels = new Map(); // peerId -> canal de ganho (áudio processado da tela, p/ palco principal)
  const remoteAudioEls = new Map(); // peerId -> { el:<audio>, channel }
  const cameraTiles = new Map(); // peerId -> <div class="camera-tile">
  const peerVolumes = new Map(); // peerId -> 0..2 (100% = 1)
  let currentScreenVolume = 1;
  let deafened = false;
  let micTestEl = null;
  let selectedCameraDeviceId = null;
  let selectedCameraQuality = cfg.DEFAULT_CAMERA_QUALITY;
  let selectedSpeakerId = "";
  const supportsSinkId = !!(document.createElement("audio").setSinkId);

  function boot() {
    mesh = new SRMesh(code, name, role === "host");
    wireMeshEvents();
    mesh.start().then(() => {
      refreshDeviceLists();
    });
    // A sala pode abrir sem nenhum clique nesta página (nome já salvo do
    // localStorage), e nesse caso o navegador bloqueia o áudio até o
    // primeiro gesto real do usuário aqui dentro (ver "_armAudioUnlock" em
    // utils.js). Avisa a pessoa pra não achar que o microfone está quebrado.
    const ctx = SR.getAudioContext();
    if (ctx.state === "suspended") {
      const hint = toast("warn", "Clique em qualquer lugar para ativar o áudio da sala.", 0);
      const clear = () => {
        hint.remove();
        document.removeEventListener("pointerdown", clear, true);
      };
      document.addEventListener("pointerdown", clear, true);
    }
    // Modo "Automático" de qualidade: reavalia a saúde da rede a cada 6s
    // e ajusta o bitrate — antes essa opção existia mas nunca fazia nada.
    setInterval(() => {
      if (mesh?.isSharingScreen && selectedQuality === "auto") {
        mesh.autoTuneBitrate("auto");
      }
    }, 6000);
  }

  // ---------------------------------------------------------------
  // Toasts / status
  // ---------------------------------------------------------------
  function toast(kind, text, timeout = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${kind} glass`;
    el.innerHTML = (kind === "warn" ? '<span class="spinner"></span>' : "") + `<span>${SR.escapeHtml(text)}</span>`;
    toastWrap.appendChild(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    return el;
  }

  let reconnectToast = null;
  function setStatus(state) {
    statusPill.classList.remove("live", "warn", "bad");
    if (state === "connected") {
      statusPill.textContent = "● Conectado";
      statusPill.classList.add("live");
      if (reconnectToast) { reconnectToast.remove(); reconnectToast = null; }
    } else if (state === "connecting") {
      statusPill.textContent = "Conectando…";
    } else if (state === "reconnecting") {
      statusPill.textContent = "Reconectando…";
      statusPill.classList.add("warn");
      if (!reconnectToast) reconnectToast = toast("warn", "Reconectando...", 0);
    } else if (state === "error" || state === "closed") {
      statusPill.textContent = "Conexão instável";
      statusPill.classList.add("bad");
    }
  }

  function showFatal(title, message) {
    document.body.innerHTML = `
      <div class="landing"><div class="scanline-field"></div>
        <div class="hero">
          <div class="hero-eyebrow"><span class="brand-dot"></span>ScreenRoom</div>
          <h1 style="font-size:2.2rem;">${SR.escapeHtml(title)}</h1>
          <p class="tagline">${SR.escapeHtml(message)}</p>
          <div class="cta-row"><a class="btn btn-primary" href="index.html">Voltar ao início</a></div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Participantes
  // ---------------------------------------------------------------
  const micStates = new Map();
  const speakingStates = new Map();
  const sharingStates = new Map();

  function renderParticipants(roster) {
    participantList.innerHTML = "";
    roster.forEach((p) => {
      const isSelf = p.id === mesh.selfId;
      const isHost = roster[0]?.id === p.id;
      const li = document.createElement("li");
      li.className = "participant" + (speakingStates.get(p.id) ? " speaking" : "");
      const micOff = isSelf ? !mesh.micEnabled : micStates.get(p.id) === false;
      const sharing = sharingStates.get(p.id);
      li.innerHTML = `
        <div class="avatar">${SR.initials(p.name)}</div>
        <div class="p-name-row">
          <div class="p-name">${SR.escapeHtml(p.name)} ${isSelf ? '<span class="you">(você)</span>' : ""} ${isHost ? '<span class="host-badge">HOST</span>' : ""}</div>
          <div class="p-meta">
            <span class="p-icons">
              <span class="${micOff ? "mic-off" : ""}">${micOff ? "🔇" : "🎤"}</span>
              ${sharing ? '<span class="sharing">🖥️ compartilhando</span>' : ""}
            </span>
          </div>
        </div>
        ${!isSelf && role === "host" && mesh.isActingHost ? `<button class="p-kick" data-kick="${p.id}">remover</button>` : ""}
      `;
      participantList.appendChild(li);
    });

    $$("[data-kick]").forEach((btn) => {
      btn.addEventListener("click", () => mesh.kickPeer(btn.dataset.kick));
    });

    $("#participantCount").textContent = roster.length + "/" + cfg.MAX_PARTICIPANTS;
    btnEndRoom.style.display = mesh.isActingHost ? "inline-flex" : "none";
  }

  // ---------------------------------------------------------------
  // Stage (tela principal)
  // ---------------------------------------------------------------
  function setMainStage(peerId, rawStream, name) {
    currentMainSharer = peerId;
    // Usa o stream já processado (com o ganho de "Volume do compartilhamento
    // de tela" aplicado) quando disponível — é o mesmo vídeo, só que o áudio
    // passou pelo canal de ganho ajustável em Configurações > Volumes.
    const isSelf = !!peerId && peerId === mesh.selfId;
    const channel = !isSelf && peerId ? screenChannels.get(peerId) : null;
    const stream = channel ? channel.stream : rawStream;
    stageVideo.srcObject = stream;
    applySpeakerToElement(stageVideo);
    // Se a tela em exibição é a SUA PRÓPRIA, muta o áudio da prévia local:
    // você já escuta seu áudio de sistema direto do seu computador, então
    // tocá-lo de novo aqui causava eco duplicado — e, com o microfone
    // aberto, esse eco era captado e reenviado para os outros (feedback).
    // Também respeita o modo "desativar áudio" (deafen).
    stageVideo.muted = isSelf || deafened;
    stageVideo.style.display = stream ? "block" : "none";
    stageEmpty.style.display = stream ? "none" : "flex";
    onAirBadge.style.display = stream ? "flex" : "none";
    stageNameBadge.style.display = stream ? "block" : "none";
    stageNameBadge.textContent = name || "";
    stage.classList.toggle("on-air", !!stream);
    renderThumbs();
  }

  function renderThumbs() {
    shareThumbs.innerHTML = "";
    if (remoteScreens.size <= 1) return;
    remoteScreens.forEach((stream, peerId) => {
      const p = mesh.roster.get(peerId);
      const div = document.createElement("div");
      div.className = "share-thumb" + (peerId === currentMainSharer ? " active" : "");
      div.innerHTML = `<video autoplay playsinline muted></video><span>${SR.escapeHtml(p?.name || "")}</span>`;
      div.querySelector("video").srcObject = stream;
      div.addEventListener("click", () => setMainStage(peerId, stream, p?.name));
      shareThumbs.appendChild(div);
    });
  }

  // ---------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------
  function addChatMessage({ name, text, ts, system }) {
    const div = document.createElement("div");
    div.className = "chat-msg" + (system ? " system" : "");
    if (system) {
      div.innerHTML = `<div class="body">${SR.escapeHtml(text)}</div>`;
    } else {
      div.innerHTML = `<div class="meta"><b>${SR.escapeHtml(name)}</b><span>${SR.formatTime(new Date(ts))}</span></div><div class="body">${SR.escapeHtml(text)}</div>`;
    }
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;

    const sidePanel = $("#panelChat");
    if (!sidePanel.classList.contains("active") || !$(".side-col").classList.contains("open")) {
      unreadChat++;
      updateChatBadge();
    }
  }
  function updateChatBadge() {
    [$("#chatBadge"), $("#chatBadgeTab")].forEach((badge) => {
      if (!badge) return;
      if (unreadChat > 0) {
        badge.style.display = "inline-flex";
        badge.textContent = unreadChat;
      } else {
        badge.style.display = "none";
      }
    });
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    mesh.sendChat(text);
    chatInput.value = "";
  });

  // ---------------------------------------------------------------
  // Configurações: dispositivos, microfone, volumes
  // ---------------------------------------------------------------

  function fillSelect(select, items, selectedId, emptyLabel) {
    const prev = select.value;
    select.innerHTML = "";
    if (!items.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = emptyLabel;
      select.appendChild(opt);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    items.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Dispositivo ${i + 1}`;
      select.appendChild(opt);
    });
    const want = selectedId || prev;
    if (want && items.some((d) => d.deviceId === want)) select.value = want;
  }

  async function refreshDeviceLists() {
    try {
      const { mics, cameras, speakers } = await mesh.listDevices();
      fillSelect(selMic, mics, mesh.micDeviceId, "Nenhum microfone encontrado");
      fillSelect(selCamera, cameras, selectedCameraDeviceId, "Nenhuma câmera encontrada");
      if (supportsSinkId) {
        const withDefault = [{ deviceId: "", label: "Padrão do sistema" }, ...speakers];
        fillSelect(selSpeaker, withDefault, selectedSpeakerId, "Nenhuma saída encontrada");
      } else {
        selSpeaker.disabled = true;
        speakerSelectHint.style.display = "block";
      }
    } catch (e) {
      toast("warn", "Não foi possível listar os dispositivos de áudio/vídeo.", 3000);
    }
  }

  Object.entries(cfg.CAMERA_PRESETS).forEach(([key, preset]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = preset.label;
    if (key === selectedCameraQuality) opt.selected = true;
    selCameraQuality.appendChild(opt);
  });

  function applySpeakerToElement(el) {
    if (!supportsSinkId || !selectedSpeakerId) return;
    el.setSinkId?.(selectedSpeakerId).catch(() => {});
  }
  function applySpeakerToAll() {
    remoteAudioEls.forEach(({ el }) => applySpeakerToElement(el));
    applySpeakerToElement(stageVideo);
    if (micTestEl) applySpeakerToElement(micTestEl);
    cameraTiles.forEach((tile) => applySpeakerToElement(tile.querySelector("video")));
  }

  // Tabs do modal de configurações
  $$(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".settings-tab").forEach((t) => t.classList.remove("active"));
      $$(".settings-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("#settingsPanel" + tab.dataset.tab[0].toUpperCase() + tab.dataset.tab.slice(1)).classList.add("active");
      if (tab.dataset.tab === "volumes") renderVolumeList();
    });
  });

  btnSettings.addEventListener("click", () => {
    settingsModal.classList.add("open");
    refreshDeviceLists();
    renderVolumeList();
  });
  btnSettingsClose.addEventListener("click", () => settingsModal.classList.remove("open"));
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove("open");
  });

  btnRefreshDevices.addEventListener("click", () => refreshDeviceLists());

  selMic.addEventListener("change", async () => {
    await mesh.setMicDevice(selMic.value);
    toast("ok", "Microfone alterado.", 1800);
  });

  selCamera.addEventListener("change", async () => {
    selectedCameraDeviceId = selCamera.value;
    if (mesh.isSharingCamera) {
      await mesh.setCameraDevice(selectedCameraDeviceId);
      toast("ok", "Câmera alterada.", 1800);
    }
  });

  selCameraQuality.addEventListener("change", () => {
    selectedCameraQuality = selCameraQuality.value;
  });

  selSpeaker.addEventListener("change", () => {
    selectedSpeakerId = selSpeaker.value;
    applySpeakerToAll();
  });

  rangeMicVolume.addEventListener("input", () => {
    const v = Number(rangeMicVolume.value) / 100;
    mesh.setMicVolume(v);
    micVolumeLabel.textContent = SR.formatPercent(v);
  });

  toggleEcho.addEventListener("change", () => mesh.setAudioConstraint("echoCancellation", toggleEcho.checked));
  toggleNoiseSup.addEventListener("change", () => mesh.setAudioConstraint("noiseSuppression", toggleNoiseSup.checked));
  toggleAGC.addEventListener("change", () => mesh.setAudioConstraint("autoGainControl", toggleAGC.checked));
  toggleIsolation.addEventListener("change", () => mesh.setVoiceIsolation(toggleIsolation.checked));

  btnMicTest.addEventListener("click", () => {
    if (micTestEl) {
      micTestEl.srcObject = null;
      micTestEl.remove();
      micTestEl = null;
      btnMicTest.textContent = "🎙️ Testar microfone";
      btnMicTest.classList.remove("active-cam");
      return;
    }
    if (!mesh.localMicStream) {
      toast("warn", "Nenhum microfone disponível para testar.", 2500);
      return;
    }
    micTestEl = document.createElement("audio");
    micTestEl.autoplay = true;
    micTestEl.srcObject = mesh.localMicStream;
    applySpeakerToElement(micTestEl);
    document.body.appendChild(micTestEl);
    btnMicTest.textContent = "⏹️ Parar teste";
    btnMicTest.classList.add("active-cam");
  });

  rangeScreenVolume.addEventListener("input", () => {
    currentScreenVolume = Number(rangeScreenVolume.value) / 100;
    screenVolumeLabel.textContent = SR.formatPercent(currentScreenVolume);
    screenChannels.forEach((ch) => ch.setVolume(currentScreenVolume));
  });

  function setPeerVolume(peerId, v) {
    peerVolumes.set(peerId, v);
    const entry = remoteAudioEls.get(peerId);
    if (entry) entry.channel.setVolume(v);
  }

  function renderVolumeList() {
    if (!mesh) return;
    volumeList.innerHTML = "";
    mesh._rosterArray()
      .filter((p) => p.id !== mesh.selfId)
      .forEach((p) => {
        const vol = peerVolumes.get(p.id) ?? 1;
        const li = document.createElement("li");
        li.className = "volume-row";
        li.innerHTML = `
          <div class="avatar">${SR.initials(p.name)}</div>
          <span class="v-name">${SR.escapeHtml(p.name)}</span>
          <input type="range" min="0" max="200" value="${Math.round(vol * 100)}" />
          <span class="v-pct">${SR.formatPercent(vol)}</span>
        `;
        const input = li.querySelector("input");
        const pct = li.querySelector(".v-pct");
        input.addEventListener("input", () => {
          const v = Number(input.value) / 100;
          setPeerVolume(p.id, v);
          pct.textContent = SR.formatPercent(v);
        });
        volumeList.appendChild(li);
      });
    if (!volumeList.children.length) {
      volumeList.innerHTML = `<li class="settings-hint" style="list-style:none;">Ninguém mais na sala ainda.</li>`;
    }
  }

  // ---------------------------------------------------------------
  // Deafen (desativar áudio — não ouvir ninguém)
  // ---------------------------------------------------------------
  let micWasEnabledBeforeDeafen = true;

  btnDeafen.addEventListener("click", () => {
    deafened = !deafened;
    btnDeafen.classList.toggle("deafened", deafened);
    btnDeafen.textContent = deafened ? "🔇" : "🎧";
    btnDeafen.title = deafened ? "Reativar áudio" : "Desativar áudio (não ouvir ninguém)";

    remoteAudioEls.forEach(({ el }) => (el.muted = deafened));
    stageVideo.muted = deafened || (!!currentMainSharer && currentMainSharer === mesh.selfId);

    if (deafened) {
      micWasEnabledBeforeDeafen = mesh.micEnabled;
      if (mesh.micEnabled) {
        mesh.toggleMic(false);
        btnMic.classList.add("off");
        btnMic.textContent = "🔇";
      }
    } else if (micWasEnabledBeforeDeafen) {
      mesh.toggleMic(true);
      btnMic.classList.remove("off");
      btnMic.textContent = "🎤";
    }
    renderParticipants(mesh._rosterArray());
  });

  // ---------------------------------------------------------------
  // Câmera
  // ---------------------------------------------------------------
  function addCameraTile(peerId, stream, label, isSelf) {
    removeCameraTile(peerId);
    const div = document.createElement("div");
    div.className = "camera-tile" + (isSelf ? " self" : "");
    div.innerHTML = `<video autoplay playsinline ${isSelf ? "muted" : ""}></video><span>${SR.escapeHtml(label)}</span>`;
    const video = div.querySelector("video");
    video.srcObject = stream;
    applySpeakerToElement(video);
    cameraStrip.appendChild(div);
    cameraTiles.set(peerId, div);
  }
  function removeCameraTile(peerId) {
    const existing = cameraTiles.get(peerId);
    if (existing) {
      existing.remove();
      cameraTiles.delete(peerId);
    }
  }

  btnCamera.addEventListener("click", async () => {
    if (mesh.isSharingCamera) {
      mesh.stopCamera();
      removeCameraTile(mesh.selfId);
      btnCamera.classList.remove("active-cam");
      return;
    }
    try {
      const stream = await mesh.startCamera(selectedCameraDeviceId, selectedCameraQuality);
      addCameraTile(mesh.selfId, stream, name + " (você)", true);
      btnCamera.classList.add("active-cam");
    } catch (e) {
      toast("bad", "Permissão de câmera negada.");
    }
  });

  // ---------------------------------------------------------------
  // Controles
  // ---------------------------------------------------------------
  btnMic.addEventListener("click", () => {
    const next = !mesh.micEnabled;
    mesh.toggleMic(next);
    btnMic.classList.toggle("off", !next);
    btnMic.textContent = next ? "🎤" : "🔇";
    micWasEnabledBeforeDeafen = next;
    if (next && deafened) {
      // Religou o mic manualmente durante o modo silencioso: sai do modo silencioso também.
      btnDeafen.click();
    }
    renderParticipants(mesh._rosterArray());
  });

  function stopOwnShareUI() {
    btnShare.classList.remove("active");
    remoteScreens.delete(mesh.selfId);
    if (currentMainSharer === mesh.selfId) {
      const next = remoteScreens.entries().next();
      if (!next.done) {
        const [pid, stream] = next.value;
        setMainStage(pid, stream, mesh.roster.get(pid)?.name);
      } else {
        setMainStage(null, null);
      }
    } else {
      renderThumbs();
    }
  }

  btnShare.addEventListener("click", async () => {
    if (mesh.isSharingScreen) {
      mesh.stopScreenShare();
      stopOwnShareUI();
      return;
    }
    try {
      const stream = await mesh.startScreenShare(selectedQuality);
      btnShare.classList.add("active");
      remoteScreens.set(mesh.selfId, stream);
      setMainStage(mesh.selfId, stream, name + " (você)");
    } catch (e) {
      toast("bad", "Permissão de compartilhamento de tela negada.");
    }
  });

  btnFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      stage.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  });

  btnLeave.addEventListener("click", () => {
    mesh?.destroy();
    location.href = "index.html";
  });

  btnEndRoom.addEventListener("click", () => {
    if (confirm("Encerrar a sala para todos os participantes?")) {
      mesh.endRoom();
      setTimeout(() => (location.href = "index.html"), 400);
    }
  });

  // Tabs participantes/chat
  $$(".side-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".side-tab").forEach((t) => t.classList.remove("active"));
      $$(".side-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("#panel" + tab.dataset.panel).classList.add("active");
      if (tab.dataset.panel === "Chat") {
        unreadChat = 0;
        updateChatBadge();
      }
    });
  });

  btnChatToggle.addEventListener("click", () => {
    $(".side-col").classList.toggle("open");
    if ($(".side-col").classList.contains("open")) {
      unreadChat = 0;
      updateChatBadge();
    }
  });

  // Menu de qualidade
  btnQuality.addEventListener("click", (e) => {
    e.stopPropagation();
    qualityMenu.classList.toggle("open");
  });
  document.addEventListener("click", () => qualityMenu.classList.remove("open"));

  Object.entries(cfg.QUALITY_PRESETS).forEach(([key, preset]) => {
    const item = document.createElement("div");
    item.className = "menu-item" + (key === selectedQuality ? " selected" : "");
    item.dataset.key = key;
    item.innerHTML = `<span>${preset.label}</span><span>${key === selectedQuality ? "✓" : ""}</span>`;
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      selectedQuality = key;
      $$(".menu-item", qualityMenu).forEach((el) => {
        el.classList.toggle("selected", el.dataset.key === key);
        el.querySelector("span:last-child").textContent = el.dataset.key === key ? "✓" : "";
      });
      qualityMenu.classList.remove("open");
      if (mesh?.isSharingScreen) await mesh.setQuality(key);
      toast("ok", `Qualidade: ${preset.label}`, 2000);
    });
    qualityMenu.appendChild(item);
  });

  roomCodeChip.addEventListener("click", () => {
    navigator.clipboard?.writeText(code).then(() => toast("ok", "Código copiado!", 1800));
  });

  // ---------------------------------------------------------------
  // Eventos do mesh
  // ---------------------------------------------------------------
  function wireMeshEvents() {
    mesh.addEventListener("status", (e) => setStatus(e.detail.state));

    mesh.addEventListener("local-share-ended", () => {
      // Compartilhamento encerrado pelo controle nativo do navegador —
      // sincroniza a interface do app com esse estado.
      stopOwnShareUI();
    });

    mesh.addEventListener("mic-denied", () => {
      toast("warn", "Microfone não autorizado — você pode continuar sem áudio.", 5000);
    });

    mesh.addEventListener("room-not-found", () => {
      showFatal("Sala não encontrada", `Não encontramos nenhuma sala ativa com o código ${code}. Verifique o código ou peça um novo link para quem criou a sala.`);
    });

    mesh.addEventListener("room-full", () => {
      showFatal("Sala cheia", `A sala ${code} já atingiu o limite de ${cfg.MAX_PARTICIPANTS} participantes.`);
    });

    mesh.addEventListener("kicked", () => {
      showFatal("Você foi removido", "O host removeu você desta sala.");
    });

    mesh.addEventListener("room-closed", () => {
      showFatal("Sala encerrada", "O host encerrou esta sala.");
    });

    mesh.addEventListener("fatal-error", (e) => {
      showFatal("Algo deu errado", e.detail.message || "Tente novamente.");
    });

    mesh.addEventListener("room-code-changed", (e) => {
      roomCodeText.textContent = e.detail.code;
      history.replaceState(null, "", `room.html?code=${e.detail.code}`);
    });

    mesh.addEventListener("roster", (e) => renderParticipants(e.detail.roster));

    mesh.addEventListener("peer-left", (e) => {
      const wasMain = e.detail.peerId === currentMainSharer;
      remoteScreens.delete(e.detail.peerId);
      const entry = remoteAudioEls.get(e.detail.peerId);
      if (entry) { entry.channel.destroy(); entry.el.remove(); remoteAudioEls.delete(e.detail.peerId); }
      const sch = screenChannels.get(e.detail.peerId);
      if (sch) { sch.destroy(); screenChannels.delete(e.detail.peerId); }
      removeCameraTile(e.detail.peerId);
      peerVolumes.delete(e.detail.peerId);
      if (wasMain) setMainStage(null, null);
      else renderThumbs();
    });

    mesh.addEventListener("remote-mic", (e) => {
      let entry = remoteAudioEls.get(e.detail.peerId);
      if (entry) { entry.channel.destroy(); entry.el.remove(); }
      const channel = SR.createGainChannel(e.detail.stream);
      channel.setVolume(peerVolumes.get(e.detail.peerId) ?? 1);
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.muted = deafened;
      audio.dataset.peer = e.detail.peerId;
      audio.srcObject = channel.stream;
      applySpeakerToElement(audio);
      document.body.appendChild(audio);
      remoteAudioEls.set(e.detail.peerId, { el: audio, channel });
    });

    mesh.addEventListener("peer-mic-state", (e) => {
      micStates.set(e.detail.peerId, e.detail.enabled);
      renderParticipants(mesh._rosterArray());
    });

    mesh.addEventListener("peer-speaking", (e) => {
      speakingStates.set(e.detail.peerId, e.detail.speaking);
      renderParticipants(mesh._rosterArray());
    });

    mesh.addEventListener("peer-share-started", (e) => {
      sharingStates.set(e.detail.peerId, true);
      renderParticipants(mesh._rosterArray());
    });
    mesh.addEventListener("peer-share-stopped", (e) => {
      sharingStates.set(e.detail.peerId, false);
      remoteScreens.delete(e.detail.peerId);
      if (currentMainSharer === e.detail.peerId) setMainStage(null, null);
      else renderThumbs();
      renderParticipants(mesh._rosterArray());
    });

    mesh.addEventListener("remote-screen", (e) => {
      remoteScreens.set(e.detail.peerId, e.detail.stream);
      const channel = SR.createGainChannel(e.detail.stream);
      channel.setVolume(currentScreenVolume);
      screenChannels.set(e.detail.peerId, channel);
      sharingStates.set(e.detail.peerId, true);
      const p = mesh.roster.get(e.detail.peerId);
      if (!currentMainSharer) {
        setMainStage(e.detail.peerId, e.detail.stream, p?.name);
      } else {
        renderThumbs();
      }
      renderParticipants(mesh._rosterArray());
    });

    mesh.addEventListener("remote-screen-ended", (e) => {
      remoteScreens.delete(e.detail.peerId);
      const ch = screenChannels.get(e.detail.peerId);
      if (ch) { ch.destroy(); screenChannels.delete(e.detail.peerId); }
      sharingStates.set(e.detail.peerId, false);
      if (currentMainSharer === e.detail.peerId) {
        const next = remoteScreens.entries().next();
        if (!next.done) {
          const [pid, stream] = next.value;
          setMainStage(pid, stream, mesh.roster.get(pid)?.name);
        } else {
          setMainStage(null, null);
        }
      } else {
        renderThumbs();
      }
      renderParticipants(mesh._rosterArray());
    });

    mesh.addEventListener("remote-camera", (e) => {
      const p = mesh.roster.get(e.detail.peerId);
      addCameraTile(e.detail.peerId, e.detail.stream, p?.name || "", false);
    });
    mesh.addEventListener("remote-camera-ended", (e) => {
      removeCameraTile(e.detail.peerId);
    });
    mesh.addEventListener("local-camera-ended", () => {
      // Câmera parada pelo controle nativo do navegador/SO.
      removeCameraTile(mesh.selfId);
      btnCamera.classList.remove("active-cam");
    });

    mesh.addEventListener("chat", (e) => {
      addChatMessage({ name: e.detail.name, text: e.detail.text, ts: e.detail.ts });
    });

    mesh.addEventListener("host-changed", (e) => {
      if (e.detail.isSelf) addChatMessage({ system: true, text: "Você agora é o host desta sala." });
      renderParticipants(mesh._rosterArray());
    });
  }

  window.addEventListener("beforeunload", () => mesh?.destroy());

  ensureNameThenBoot();
})();
