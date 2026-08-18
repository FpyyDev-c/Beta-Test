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
  const btnShare = $("#btnShare");
  const btnChatToggle = $("#btnChatToggle");
  const btnFullscreen = $("#btnFullscreen");
  const btnLeave = $("#btnLeave");
  const btnQuality = $("#btnQuality");
  const qualityMenu = $("#qualityMenu");
  const btnEndRoom = $("#btnEndRoom");

  roomCodeText.textContent = code;

  // ---- Estado local de UI ----
  let mesh = null;
  let currentMainSharer = null; // peerId sendo exibido no stage
  let selectedQuality = cfg.DEFAULT_QUALITY;
  let unreadChat = 0;
  const remoteScreens = new Map(); // peerId -> stream
  const remoteAudioEls = new Map(); // peerId -> <audio>

  function boot() {
    mesh = new SRMesh(code, name, role === "host");
    wireMeshEvents();
    mesh.start();
    // Modo "Automático" de qualidade: reavalia a saúde da rede a cada 6s
    // e ajusta o bitrate — antes essa opção existia mas nunca fazia nada.
    setInterval(() => {
      if (mesh?.isSharingScreen && selectedQuality === "auto") {
        mesh.autoTuneBitrate();
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
  function setMainStage(peerId, stream, name) {
    currentMainSharer = peerId;
    stageVideo.srcObject = stream;
    // Se a tela em exibição é a SUA PRÓPRIA, muta o áudio da prévia local:
    // você já escuta seu áudio de sistema direto do seu computador, então
    // tocá-lo de novo aqui causava eco duplicado — e, com o microfone
    // aberto, esse eco era captado e reenviado para os outros (feedback).
    stageVideo.muted = !!peerId && peerId === mesh.selfId;
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
  // Controles
  // ---------------------------------------------------------------
  btnMic.addEventListener("click", () => {
    const next = !mesh.micEnabled;
    mesh.toggleMic(next);
    btnMic.classList.toggle("off", !next);
    btnMic.textContent = next ? "🎤" : "🔇";
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
      const a = remoteAudioEls.get(e.detail.peerId);
      if (a) { a.remove(); remoteAudioEls.delete(e.detail.peerId); }
      if (wasMain) setMainStage(null, null);
      else renderThumbs();
    });

    mesh.addEventListener("remote-mic", (e) => {
      let audio = remoteAudioEls.get(e.detail.peerId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.dataset.peer = e.detail.peerId;
        document.body.appendChild(audio);
        remoteAudioEls.set(e.detail.peerId, audio);
      }
      audio.srcObject = e.detail.stream;
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
