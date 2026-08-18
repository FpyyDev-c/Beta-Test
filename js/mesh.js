/**
 * ScreenRoom — SRMesh
 * ---------------------------------------------------------------
 * Camada de rede P2P em malha completa (full-mesh) usando a rede
 * pública de signaling do PeerJS (https://peerjs.com), que é gratuita,
 * não exige conta e não exige servidor próprio. O vídeo/áudio NUNCA
 * passa por um servidor — apenas o "aperto de mão" inicial (SDP/ICE)
 * passa pelo broker do PeerJS, e mensagens pequenas de roster passam
 * pelo host (texto, não mídia).
 *
 * ID da sala = ID do PeerJS do "host" (screenroom-v1-<CODIGO>). Isso é
 * só um ponto de encontro: uma vez que todos se conectaram entre si
 * (mesh), a saída do host não derruba as conexões já existentes — só
 * afeta a entrada de NOVOS participantes, por isso implementamos
 * migração de host (ver _tryBecomeHost).
 *
 * Regra de desempate de conexão (evita conexão duplicada A->B e B->A):
 * entre dois peers, quem tem o ID menor (ordem alfabética) é quem
 * inicia a conexão.
 * ---------------------------------------------------------------
 */

class SRMesh extends EventTarget {
  constructor(roomCode, localName, wantsToHost) {
    super();
    const cfg = window.SR_CONFIG;
    this.cfg = cfg;
    this.roomCode = roomCode.toUpperCase();
    this.hostPeerId = SR.peerIdForRoom(this.roomCode);
    this.localName = localName;
    this.wantsToHost = wantsToHost;

    this.peer = null;
    this.selfId = null;
    this.isActingHost = false;

    /** @type {Map<string,{id:string,name:string,joinedAt:number}>} */
    this.roster = new Map();
    /** @type {Map<string, any>} DataConnection por peerId */
    this.dataConns = new Map();
    /** @type {Map<string, any>} MediaConnection (mic) por peerId */
    this.micConns = new Map();
    /** @type {Map<string, any>} MediaConnection (tela) recebidas, por peerId de origem */
    this.screenConnsIn = new Map();
    /** @type {Map<string, any>} MediaConnection (tela) enviadas, por peerId de destino */
    this.screenConnsOut = new Map();

    this.localMicStream = null;
    this.localScreenStream = null;
    this.isSharingScreen = false;
    this.micEnabled = true;

    this.destroyed = false;
    this.hostCreateAttempts = 0;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  log(...args) {
    console.log("[ScreenRoom]", ...args);
  }

  // ---------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------

  async start() {
    try {
      this.localMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      this.emit("mic-denied", { error: e });
      // Segue sem microfone — usuário pode continuar só assistindo/no chat.
      this.localMicStream = null;
    }

    if (this.wantsToHost) {
      this._createHostPeer();
    } else {
      this._createGuestPeer();
    }

    this._setupVoiceActivityDetection();
  }

  /**
   * Detecção simples de voz (VAD) via Web Audio API, para acender o
   * indicador de "falando" dos participantes. Antes esse indicador nunca
   * era usado — sendSpeaking() existia mas nada chamava.
   */
  _setupVoiceActivityDetection() {
    if (!this.localMicStream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this._vadCtx = new AudioCtx();
      const source = this._vadCtx.createMediaStreamSource(this.localMicStream);
      const analyser = this._vadCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const THRESHOLD = 14;
      const HOLD_MS = 250;
      let speaking = false;
      let lastChange = 0;

      const tick = () => {
        if (this.destroyed) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const now = Date.now();
        const isSpeaking = avg > THRESHOLD && this.micEnabled;
        if (isSpeaking !== speaking && now - lastChange > HOLD_MS) {
          speaking = isSpeaking;
          lastChange = now;
          this.sendSpeaking(speaking);
          if (this.selfId) this.emit("peer-speaking", { peerId: this.selfId, speaking });
        }
        this._vadRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      this.log("Detecção de voz indisponível:", e);
    }
  }

  _basePeerOptions() {
    return {
      ...this.cfg.PEERJS_OPTIONS,
      config: { iceServers: this.cfg.ICE_SERVERS },
    };
  }

  _createHostPeer() {
    this.emit("status", { state: "connecting" });
    const peer = new Peer(this.hostPeerId, this._basePeerOptions());
    this.peer = peer;

    peer.on("open", (id) => {
      this.selfId = id;
      this.isActingHost = true;
      this.roster.set(id, { id, name: this.localName, joinedAt: Date.now() });
      this._wirePeerEvents();
      this.emit("status", { state: "connected" });
      this.emit("roster", { roster: this._rosterArray() });
      this.emit("host-changed", { hostId: id, isSelf: true });
    });

    peer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        this.hostCreateAttempts++;
        if (this.hostCreateAttempts <= 3) {
          // Colisão rara no broker público: gera outro código e tenta de novo.
          this.roomCode = SR.generateRoomCode();
          this.hostPeerId = SR.peerIdForRoom(this.roomCode);
          this.emit("room-code-changed", { code: this.roomCode });
          setTimeout(() => this._createHostPeer(), 300);
        } else {
          this.emit("fatal-error", { message: "Não foi possível criar a sala. Tente novamente." });
        }
        return;
      }
      this._handlePeerError(err);
    });
  }

  _createGuestPeer() {
    this.emit("status", { state: "connecting" });
    const peer = new Peer("screenroom-v1-guest-" + SR.randomId(10), this._basePeerOptions());
    this.peer = peer;

    peer.on("open", (id) => {
      this.selfId = id;
      this._wirePeerEvents();
      this._connectToHostAsGuest();
    });

    peer.on("error", (err) => this._handlePeerError(err));
  }

  _connectToHostAsGuest() {
    const conn = this.peer.connect(this.hostPeerId, {
      reliable: true,
      metadata: { name: this.localName, kind: "bootstrap" },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        this.emit("room-not-found", {});
      }
    }, 9000);

    conn.on("open", () => {
      settled = true;
      clearTimeout(timeout);
      this._registerDataConn(conn);
      conn.send({ type: "join", name: this.localName, id: this.selfId });
    });

    conn.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        this.emit("room-not-found", {});
      }
    });
  }

  _handlePeerError(err) {
    this.log("peer error", err);
    if (err.type === "peer-unavailable") {
      // Só é considerado "sala não encontrada" durante o bootstrap inicial.
      if (this.roster.size === 0) this.emit("room-not-found", {});
      return;
    }
    if (err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "socket-closed") {
      this.emit("status", { state: "reconnecting" });
      this._attemptReconnect();
      return;
    }
    this.emit("status", { state: "error", message: err.type });
  }

  _attemptReconnect() {
    if (this.destroyed || !this.peer) return;
    if (this.peer.disconnected) {
      try {
        this.peer.reconnect();
      } catch (e) {
        /* ignore */
      }
    }
    setTimeout(() => {
      if (this.destroyed) return;
      if (this.peer && this.peer.disconnected) {
        this._attemptReconnect();
      } else if (this.peer && !this.peer.destroyed) {
        this.emit("status", { state: "connected" });
      }
    }, 3000);
  }

  // ---------------------------------------------------------------
  // Eventos gerais do Peer (comuns a host e guest)
  // ---------------------------------------------------------------

  _wirePeerEvents() {
    const peer = this.peer;

    peer.on("connection", (conn) => {
      conn.on("open", () => {
        this._registerDataConn(conn);
      });
    });

    peer.on("call", (call) => {
      const kind = call.metadata && call.metadata.kind;
      if (kind === "screen") {
        call.answer(); // recebendo apenas, não enviamos stream de volta nessa call
        call.on("stream", (stream) => {
          this.screenConnsIn.set(call.peer, call);
          this.emit("remote-screen", { peerId: call.peer, stream });
        });
        call.on("close", () => {
          this.screenConnsIn.delete(call.peer);
          this.emit("remote-screen-ended", { peerId: call.peer });
        });
      } else {
        // chamada de microfone
        call.answer(this.localMicStream || undefined);
        call.on("stream", (stream) => {
          this.micConns.set(call.peer, call);
          this.emit("remote-mic", { peerId: call.peer, stream });
        });
        call.on("close", () => this._onPeerFullyGone(call.peer));
      }
    });

    peer.on("disconnected", () => {
      this.emit("status", { state: "reconnecting" });
      this._attemptReconnect();
    });

    peer.on("close", () => {
      this.emit("status", { state: "closed" });
    });
  }

  // ---------------------------------------------------------------
  // Conexões de dados (roster, chat, controle)
  // ---------------------------------------------------------------

  _registerDataConn(conn) {
    if (this.dataConns.has(conn.peer)) return;
    this.dataConns.set(conn.peer, conn);

    conn.on("data", (msg) => this._onData(conn.peer, msg));
    conn.on("close", () => this._onDataConnClosed(conn.peer));
    conn.on("error", () => this._onDataConnClosed(conn.peer));
  }

  _onData(fromId, msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "join": {
        // Só o host trata "join" (bootstrap de um novo participante).
        if (!this.isActingHost) return;
        if (this.roster.size >= this.cfg.MAX_PARTICIPANTS) {
          const conn = this.dataConns.get(fromId);
          if (conn) conn.send({ type: "room-full" });
          setTimeout(() => this.dataConns.get(fromId)?.close(), 300);
          return;
        }
        this.roster.set(fromId, { id: fromId, name: msg.name || "Convidado", joinedAt: Date.now() });
        this._broadcastRoster();
        this.emit("roster", { roster: this._rosterArray() });
        this._callWithMicIfNeeded(fromId);
        if (this.isSharingScreen) this._callWithScreen(fromId);
        break;
      }
      case "room-full": {
        this.emit("room-full", {});
        break;
      }
      case "roster": {
        const incoming = new Map(msg.list.map((p) => [p.id, p]));
        this.roster = incoming;
        this.emit("roster", { roster: this._rosterArray() });
        this._reconcileMesh();
        this._checkHostSuccession();
        break;
      }
      case "chat": {
        this.emit("chat", { fromId, name: msg.name, text: msg.text, ts: msg.ts || Date.now() });
        break;
      }
      case "mic-state": {
        this.emit("peer-mic-state", { peerId: fromId, enabled: msg.enabled });
        break;
      }
      case "speaking": {
        this.emit("peer-speaking", { peerId: fromId, speaking: msg.speaking });
        break;
      }
      case "share-started": {
        this.emit("peer-share-started", { peerId: fromId });
        break;
      }
      case "share-stopped": {
        this.emit("peer-share-stopped", { peerId: fromId });
        break;
      }
      case "kicked": {
        this.emit("kicked", {});
        break;
      }
      case "room-closed": {
        this.emit("room-closed", {});
        break;
      }
      default:
        break;
    }
  }

  _onDataConnClosed(peerId) {
    this.dataConns.delete(peerId);
    this.micConns.delete(peerId);
    this.screenConnsIn.delete(peerId);
    this.screenConnsOut.delete(peerId);

    const wasHost = this.roster.get(peerId) && this._rosterArray()[0]?.id === peerId;
    if (this.roster.has(peerId)) {
      this.roster.delete(peerId);
      this.emit("roster", { roster: this._rosterArray() });
      this.emit("peer-left", { peerId });
    }

    if (this.isActingHost) {
      this._broadcastRoster();
    } else if (wasHost) {
      this._checkHostSuccession();
    }
  }

  _broadcastRoster() {
    const list = this._rosterArray();
    for (const conn of this.dataConns.values()) {
      if (conn.open) conn.send({ type: "roster", list });
    }
  }

  _rosterArray() {
    return [...this.roster.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  // ---------------------------------------------------------------
  // Formação da malha completa (mesh) entre todos os participantes
  // ---------------------------------------------------------------

  _reconcileMesh() {
    for (const p of this.roster.values()) {
      if (p.id === this.selfId) continue;
      if (this.dataConns.has(p.id)) continue;
      // Regra de desempate: só quem tem o ID "menor" inicia a conexão.
      if (this.selfId < p.id) {
        this._connectMeshPeer(p.id);
      }
    }
  }

  _connectMeshPeer(peerId) {
    const conn = this.peer.connect(peerId, { reliable: true, metadata: { name: this.localName, kind: "mesh" } });
    conn.on("open", () => {
      this._registerDataConn(conn);
      this._callWithMicIfNeeded(peerId);
      if (this.isSharingScreen) this._callWithScreen(peerId);
    });
  }

  _callWithMicIfNeeded(peerId) {
    if (this.micConns.has(peerId)) return;
    const call = this.peer.call(peerId, this.localMicStream || new MediaStream(), {
      metadata: { kind: "mic" },
    });
    if (!call) return;
    call.on("stream", (stream) => {
      this.micConns.set(peerId, call);
      this.emit("remote-mic", { peerId, stream });
    });
    call.on("close", () => this._onPeerFullyGone(peerId));
  }

  _onPeerFullyGone(peerId) {
    this.micConns.delete(peerId);
  }

  // ---------------------------------------------------------------
  // Migração de host
  // ---------------------------------------------------------------

  _checkHostSuccession() {
    if (this.destroyed) return;
    const ordered = this._rosterArray();
    if (ordered.length === 0) return;
    const shouldBeHost = ordered[0].id === this.selfId;
    if (shouldBeHost && !this.isActingHost && this.peer && this.peer.id !== this.hostPeerId) {
      this._tryBecomeHost();
    }
  }

  _tryBecomeHost() {
    if (this.destroyed) return;
    this.log("Assumindo papel de host da sala...");
    const oldPeer = this.peer;
    const newPeer = new Peer(this.hostPeerId, this._basePeerOptions());

    newPeer.on("open", (id) => {
      this.peer = newPeer;
      this.selfId = id;
      this.isActingHost = true;
      this._wirePeerEvents();
      this.emit("host-changed", { hostId: id, isSelf: true });
      this._broadcastRoster();
      // As conexões antigas (mesh já existente) continuam válidas — eram feitas
      // com o peer antigo (guest id), então mantemos ambos objetos Peer vivos
      // até as conexões antigas fecharem naturalmente.
    });

    newPeer.on("error", (err) => {
      // Outro participante pode ter vencido a corrida — normal, apenas ignora.
      this.log("Não foi possível assumir o host agora:", err.type);
    });
  }

  // ---------------------------------------------------------------
  // API pública: mic, tela, chat, controles de host
  // ---------------------------------------------------------------

  toggleMic(enabled) {
    this.micEnabled = enabled;
    if (this.localMicStream) {
      this.localMicStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
    }
    this._broadcast({ type: "mic-state", enabled });
    if (!enabled) {
      // Ao mutar, apaga o indicador de "falando" na hora (sem esperar o VAD).
      this.sendSpeaking(false);
      if (this.selfId) this.emit("peer-speaking", { peerId: this.selfId, speaking: false });
    }
  }

  sendSpeaking(speaking) {
    this._broadcast({ type: "speaking", speaking });
  }

  async startScreenShare(qualityKey) {
    const preset = this.cfg.QUALITY_PRESETS[qualityKey] || this.cfg.QUALITY_PRESETS[this.cfg.DEFAULT_QUALITY];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      audio: true, // navegador decide se oferece a opção de áudio do sistema
    });

    this.localScreenStream = stream;
    this.isSharingScreen = true;
    this._applyBitrateCap(preset.maxBitrateKbps);

    stream.getVideoTracks()[0].addEventListener("ended", () => {
      // Cobre o caso de o usuário parar pelo controle NATIVO do navegador
      // (barra "Parar apresentação"/"Stop sharing") em vez do botão do app —
      // antes isso encerrava o compartilhamento por dentro, mas a interface
      // (botão, palco, miniaturas) ficava travada como se ainda estivesse ativa.
      this.stopScreenShare();
      this.emit("local-share-ended", {});
    });

    for (const peerId of this.dataConns.keys()) {
      this._callWithScreen(peerId);
    }
    this._broadcast({ type: "share-started" });
    return stream;
  }

  _callWithScreen(peerId) {
    if (!this.localScreenStream) return;
    const call = this.peer.call(peerId, this.localScreenStream, { metadata: { kind: "screen" } });
    if (call) this.screenConnsOut.set(peerId, call);
  }

  stopScreenShare() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
    }
    for (const call of this.screenConnsOut.values()) {
      try { call.close(); } catch (e) {}
    }
    this.screenConnsOut.clear();
    this.localScreenStream = null;
    this.isSharingScreen = false;
    this._broadcast({ type: "share-stopped" });
  }

  async setQuality(qualityKey) {
    const preset = this.cfg.QUALITY_PRESETS[qualityKey];
    if (!preset) return;
    this._applyBitrateCap(preset.maxBitrateKbps);
    if (this.localScreenStream) {
      const track = this.localScreenStream.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        try {
          await track.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate },
          });
        } catch (e) { /* nem todo navegador permite re-aplicar em telas compartilhadas */ }
      }
    }
  }

  _applyBitrateCap(kbps) {
    for (const call of this.screenConnsOut.values()) {
      const pc = call.peerConnection;
      if (!pc) continue;
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (!sender) continue;
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = kbps * 1000;
      sender.setParameters(params).catch(() => {});
    }
  }

  /**
   * Modo "Automático": mede a saúde da conexão de saída e ajusta o
   * bitrate máximo de vídeo em tempo real. Antes esse método existia
   * mas nunca era chamado — a opção "Automático" ficava travada nos
   * valores padrão de 1080p30 e nunca reagia à rede.
   */
  async autoTuneBitrate() {
    if (!this.isSharingScreen || this.screenConnsOut.size === 0) return;
    const health = await this.getOutboundHealth();
    let targetKbps;
    if (health.packetLoss > 0.08 || health.jitter > 0.05) {
      targetKbps = 1000; // rede ruim: prioriza estabilidade
    } else if (health.packetLoss > 0.03) {
      targetKbps = 2200; // rede instável: qualidade média
    } else {
      targetKbps = 3500; // rede boa: 1080p confortável
    }
    this._applyBitrateCap(targetKbps);
  }

  /** Estatísticas simples de saúde da conexão (para modo Automático). */
  async getOutboundHealth() {
    let worst = { packetLoss: 0, jitter: 0 };
    for (const call of this.screenConnsOut.values()) {
      const pc = call.peerConnection;
      if (!pc) continue;
      const stats = await pc.getStats();
      stats.forEach((r) => {
        if (r.type === "remote-inbound-rtp" && r.kind === "video") {
          const loss = r.fractionLost || 0;
          if (loss > worst.packetLoss) worst.packetLoss = loss;
          if (r.jitter > worst.jitter) worst.jitter = r.jitter;
        }
      });
    }
    return worst;
  }

  sendChat(text) {
    const msg = { type: "chat", name: this.localName, text, ts: Date.now() };
    this.emit("chat", { fromId: this.selfId, name: this.localName, text, ts: msg.ts, self: true });
    this._broadcast(msg);
  }

  _broadcast(msg) {
    for (const conn of this.dataConns.values()) {
      if (conn.open) conn.send(msg);
    }
  }

  kickPeer(peerId) {
    if (!this.isActingHost) return;
    const conn = this.dataConns.get(peerId);
    if (conn && conn.open) conn.send({ type: "kicked" });
    setTimeout(() => {
      this.roster.delete(peerId);
      this._broadcastRoster();
      this.emit("roster", { roster: this._rosterArray() });
      conn?.close();
    }, 200);
  }

  endRoom() {
    if (!this.isActingHost) return;
    this._broadcast({ type: "room-closed" });
    setTimeout(() => this.destroy(), 300);
  }

  copyInviteCode() {
    return this.roomCode;
  }

  destroy() {
    this.destroyed = true;
    if (this._vadRaf) cancelAnimationFrame(this._vadRaf);
    try { this._vadCtx?.close(); } catch (e) {}
    try { this.localMicStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.localScreenStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.peer?.destroy(); } catch (e) {}
  }
}

window.SRMesh = SRMesh;
