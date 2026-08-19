/**
 * ScreenRoom — utilidades compartilhadas entre landing.js e room.js
 */
window.SR = window.SR || {};

(function () {
  const cfg = window.SR_CONFIG;

  /** Gera um código de sala de 5 caracteres, sem caracteres confusos. */
  function generateRoomCode() {
    let code = "";
    for (let i = 0; i < cfg.ROOM_CODE_LENGTH; i++) {
      code += cfg.ROOM_CODE_CHARS[Math.floor(Math.random() * cfg.ROOM_CODE_CHARS.length)];
    }
    return code;
  }

  function isValidRoomCode(code) {
    if (!code) return false;
    code = code.trim().toUpperCase();
    if (code.length !== cfg.ROOM_CODE_LENGTH) return false;
    return [...code].every((c) => cfg.ROOM_CODE_CHARS.includes(c));
  }

  function peerIdForRoom(code) {
    return cfg.ROOM_PREFIX + code.trim().toUpperCase();
  }

  function getSavedName() {
    try {
      return localStorage.getItem("screenroom:name") || "";
    } catch (e) {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem("screenroom:name", name.trim().slice(0, 30));
    } catch (e) {
      /* localStorage indisponível (modo privado etc.) — segue sem salvar */
    }
  }

  function randomId(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatTime(date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // ---------------------------------------------------------------
  // Áudio: AudioContext compartilhado + roteamento com ganho ajustável
  // ---------------------------------------------------------------

  let sharedCtx = null;
  /** AudioContext único, reaproveitado por todo o app (mic, remotos, testes). */
  function getAudioContext() {
    if (!sharedCtx || sharedCtx.state === "closed") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      sharedCtx = new AudioCtx();
    }
    if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
    return sharedCtx;
  }

  /**
   * Recebe um MediaStream (áudio, com ou sem vídeo junto — ex: tela/câmera com
   * áudio do sistema) e devolve um "canal" com volume ajustável em tempo real
   * (0 a 200%+), sem precisar recriar a conexão. Isso é o que permite subir/
   * descer o volume de cada participante e do compartilhamento de tela
   * independentemente, como no Discord.
   *
   * Retorna { stream, gainNode, setVolume(v), destroy() }.
   * `stream` já inclui as faixas de vídeo originais (se houver) + o áudio
   * processado — pode ser jogado direto num <video>/<audio> com autoplay.
   */
  function createGainChannel(sourceStream) {
    const ctx = getAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = 1;

    const audioTracks = sourceStream.getAudioTracks();
    let outStream;
    let sourceNode = null;
    let destNode = null;

    if (audioTracks.length > 0) {
      sourceNode = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      destNode = ctx.createMediaStreamDestination();
      sourceNode.connect(gainNode);
      gainNode.connect(destNode);
      outStream = new MediaStream([...sourceStream.getVideoTracks(), ...destNode.stream.getAudioTracks()]);
    } else {
      // Sem faixa de áudio (ex: câmera sem microfone próprio) — nada a processar.
      outStream = sourceStream;
    }

    return {
      stream: outStream,
      gainNode,
      setVolume(v) {
        gainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      },
      destroy() {
        try { sourceNode?.disconnect(); } catch (e) {}
        try { gainNode.disconnect(); } catch (e) {}
        try { destNode?.disconnect(); } catch (e) {}
      },
    };
  }

  function formatPercent(v) {
    return Math.round(v * 100) + "%";
  }

  function detectBrowserSupport() {
    const issues = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      issues.push("Este navegador não suporta acesso a microfone/câmera (getUserMedia).");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      issues.push("Este navegador não suporta compartilhamento de tela (getDisplayMedia).");
    }
    if (!window.RTCPeerConnection) {
      issues.push("Este navegador não suporta WebRTC.");
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      issues.push("Este site precisa ser acessado via HTTPS para microfone/tela funcionarem.");
    }
    return issues;
  }

  window.SR.generateRoomCode = generateRoomCode;
  window.SR.isValidRoomCode = isValidRoomCode;
  window.SR.peerIdForRoom = peerIdForRoom;
  window.SR.getSavedName = getSavedName;
  window.SR.saveName = saveName;
  window.SR.randomId = randomId;
  window.SR.escapeHtml = escapeHtml;
  window.SR.initials = initials;
  window.SR.formatTime = formatTime;
  window.SR.detectBrowserSupport = detectBrowserSupport;
  window.SR.getAudioContext = getAudioContext;
  window.SR.createGainChannel = createGainChannel;
  window.SR.formatPercent = formatPercent;
})();
