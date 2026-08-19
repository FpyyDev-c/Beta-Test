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

    /** @type {Map<string, any>} MediaConnection (câmera) recebidas, por peerId de origem */
    this.cameraConnsIn = new Map();
    /** @type {Map<string, any>} MediaConnection (câmera) enviadas, por peerId de destino */
    this.cameraConnsOut = new Map();

    this.rawMicStream = null;   // captura crua do getUserMedia (antes do processamento)
    this.localMicStream = null; // stream processada (ganho + isolamento de voz) — é essa que vai pros outros
    this.localScreenStream = null;
    this.localCameraStream = null;
    this.isSharingScreen = false;
    this.isSharingCamera = false;
    this.micEnabled = true;

    // Configurações de áudio de entrada. Espelha window.SR_CONFIG.DEFAULT_AUDIO_SETTINGS.
    this.audioSettings = { ...(cfg.DEFAULT_AUDIO_SETTINGS || {}) };
    this.micDeviceId = null;
    this.cameraDeviceId = null;

    // Nós do grafo de Web Audio usados para processar o microfone local
    // (ganho ajustável + "isolamento de voz"). Ver _buildMicGraph().
    this._micAudioCtx = null;
    this._micSourceNode = null;
    this._micHighpass = null;
    this._micLowpass = null;
    this._micCompressor = null;
    this._micGainNode = null;
    this._micDestNode = null;

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
    await this._acquireMic({});

    if (this.wantsToHost) {
      this._createHostPeer();
    } else {
      this._createGuestPeer();
    }

    this._setupVoiceActivityDetection();
  }

  // ---------------------------------------------------------------
  // Microfone: captura + grafo de processamento (ganho / isolamento de voz)
  // ---------------------------------------------------------------

  /**
   * Pede/reabre o microfone (opcionalmente um dispositivo específico) e
   * monta o grafo de processamento em cima da captura crua. Usado tanto no
   * boot quanto ao trocar de dispositivo de entrada ou mudar cancelamento
   * de eco/supressão de ruído/AGC (que só têm efeito numa nova captura).
   */
  async _acquireMic({ deviceId } = {}) {
    const wantedId = deviceId !== undefined ? deviceId : this.micDeviceId;
    const constraints = {
      audio: {
        echoCancellation: !!this.audioSettings.echoCancellation,
        noiseSuppression: !!this.audioSettings.noiseSuppression,
        autoGainControl: !!this.audioSettings.autoGainControl,
        ...(wantedId ? { deviceId: { exact: wantedId } } : {}),
      },
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (wantedId) {
        // Dispositivo salvo pode ter sido desconectado — cai pro padrão do sistema.
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: !!this.audioSettings.echoCancellation,
              noiseSuppression: !!this.audioSettings.noiseSuppression,
              autoGainControl: !!this.audioSettings.autoGainControl,
            },
          });
        } catch (e2) {
          this.emit("mic-denied", { error: e2 });
          this.rawMicStream = null;
          this.localMicStream = null;
          return;
        }
      } else {
        this.emit("mic-denied", { error: e });
        this.rawMicStream = null;
        this.localMicStream = null;
        return;
      }
    }

    // Se já havia uma captura anterior (troca de dispositivo em uso), encerra.
    if (this.rawMicStream) {
      try { this.rawMicStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    }
    this.rawMicStream = stream;
    const track = stream.getAudioTracks()[0];
    this.micDeviceId = track?.getSettings?.().deviceId || wantedId || null;

    this._buildMicGraph(stream);
    this.localMicStream.getAudioTracks().forEach((t) => (t.enabled = this.micEnabled));

    // Se já estamos numa sala com chamadas de mic ativas, troca a faixa
    // "ao vivo" sem precisar renegociar a conexão inteira (sem corte de áudio).
    const newTrack = this.localMicStream.getAudioTracks()[0];
    if (newTrack) {
      for (const call of this.micConns.values()) {
        const sender = call.peerConnection?.getSenders().find((s) => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
      }
    }
  }

  /**
   * Monta a cadeia: captura crua -> filtro passa-altas -> filtro passa-baixas
   * -> compressor dinâmico (leve "gate" de ruído de fundo) -> ganho -> saída.
   * Os filtros de "isolamento de voz" ficam sempre no grafo, mas com valores
   * neutros quando desativados (evita reconstruir o grafo — e cortar o áudio
   * por um instante — só para ligar/desligar a opção).
   */
  _buildMicGraph(rawStream) {
    try { this._micSourceNode?.disconnect(); } catch (e) {}
    try { this._micGainNode?.disconnect(); } catch (e) {}
    try { this._micDestNode?.disconnect(); } catch (e) {}

    const ctx = SR.getAudioContext();
    this._micAudioCtx = ctx;

    const source = ctx.createMediaStreamSource(rawStream);
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    const compressor = ctx.createDynamicsCompressor();
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.audioSettings.micVolume ?? 1;
    const dest = ctx.createMediaStreamDestination();

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(dest);

    this._micSourceNode = source;
    this._micHighpass = highpass;
    this._micLowpass = lowpass;
    this._micCompressor = compressor;
    this._micGainNode = gainNode;
    this._micDestNode = dest;

    this._applyVoiceIsolationParams();
    this.localMicStream = dest.stream;
  }

  /** Aplica (ou remove) o filtro de isolamento de voz sem recriar o grafo. */
  _applyVoiceIsolationParams() {
    if (!this._micHighpass) return;
    if (this.audioSettings.voiceIsolation) {
      // Faixa aproximada da voz humana falada: corta rumble/vento abaixo de
      // ~100Hz e chiado/agudos acima de ~7.5kHz, e comprime picos para
      // atenuar ruído de fundo constante (ventilador, teclado, etc.).
      this._micHighpass.frequency.setTargetAtTime(100, this._micAudioCtx.currentTime, 0.05);
      this._micLowpass.frequency.setTargetAtTime(7500, this._micAudioCtx.currentTime, 0.05);
      this._micCompressor.threshold.setTargetAtTime(-45, this._micAudioCtx.currentTime, 0.05);
      this._micCompressor.ratio.setTargetAtTime(8, this._micAudioCtx.currentTime, 0.05);
    } else {
      this._micHighpass.frequency.setTargetAtTime(20, this._micAudioCtx.currentTime, 0.05);
      this._micLowpass.frequency.setTargetAtTime(20000, this._micAudioCtx.currentTime, 0.05);
      this._micCompressor.threshold.setTargetAtTime(-24, this._micAudioCtx.currentTime, 0.05);
      this._micCompressor.ratio.setTargetAtTime(3, this._micAudioCtx.currentTime, 0.05);
    }
  }

  /** Troca o dispositivo de entrada (microfone) em uso. */
  async setMicDevice(deviceId) {
    await this._acquireMic({ deviceId });
    this._restartVoiceActivityDetection();
    return this.micDeviceId;
  }

  /** Ganho de entrada do microfone, de 0 a 2 (0%–200%). */
  setMicVolume(v) {
    const cfg = this.cfg;
    const clamped = Math.max(cfg.MIC_VOLUME_MIN ?? 0, Math.min(cfg.MIC_VOLUME_MAX ?? 2, v));
    this.audioSettings.micVolume = clamped;
    if (this._micGainNode) this._micGainNode.gain.setTargetAtTime(clamped, this._micAudioCtx.currentTime, 0.01);
    return clamped;
  }

  setVoiceIsolation(enabled) {
    this.audioSettings.voiceIsolation = !!enabled;
    this._applyVoiceIsolationParams();
  }

  /** Liga/desliga cancelamento de eco, supressão de ruído ou AGC (reabre a captura). */
  async setAudioConstraint(name, enabled) {
    if (!["echoCancellation", "noiseSuppression", "autoGainControl"].includes(name)) return;
    this.audioSettings[name] = !!enabled;
    await this._acquireMic({ deviceId: this.micDeviceId });
    this._restartVoiceActivityDetection();
  }

  /** Lista os dispositivos de mídia disponíveis (precisa de permissão já concedida para nomes). */
  async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter((d) => d.kind === "audioinput"),
      cameras: devices.filter((d) => d.kind === "videoinput"),
      speakers: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  _restartVoiceActivityDetection() {
    // NÃO fecha _vadCtx aqui: desde a correção acima ele é o AudioContext
    // COMPARTILHADO (mesmo usado pro mic e pro áudio recebido dos outros) —
    // fechá-lo derrubaria o áudio da sala inteira, não só o detector de voz.
    if (this._vadRaf) cancelAnimationFrame(this._vadRaf);
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
      // Usa o AudioContext COMPARTILHADO (SR.getAudioContext) em vez de criar
      // um novo — além de evitar acumular vários contextos (o navegador tem
      // limite), o compartilhado já tem o "destravador" de autoplay armado,
      // então o indicador de "falando" também volta a funcionar em salas que
      // abrem sem clique prévio (ver utils.js).
      this._vadCtx = SR.getAudioContext();
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
      } else if (kind === "camera") {
        call.answer(); // recebendo apenas
        call.on("stream", (stream) => {
          this.cameraConnsIn.set(call.peer, call);
          this.emit("remote-camera", { peerId: call.peer, stream });
        });
        call.on("close", () => {
          this.cameraConnsIn.delete(call.peer);
          this.emit("remote-camera-ended", { peerId: call.peer });
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
        if (this.isSharingCamera) this._callWithCamera(fromId);
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
      case "camera-started": {
        this.emit("peer-camera-started", { peerId: fromId });
        break;
      }
      case "camera-stopped": {
        this.emit("peer-camera-stopped", { peerId: fromId });
        break;
      }
      case "deafen-state": {
        this.emit("peer-deafen-state", { peerId: fromId, deafened: msg.deafened });
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
    this.cameraConnsIn.delete(peerId);
    this.cameraConnsOut.delete(peerId);

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
      if (this.isSharingCamera) this._callWithCamera(peerId);
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
    // "detail" diz ao encoder pra priorizar nitidez de texto/imagem estática
    // sobre suavidade de movimento — o padrão do navegador ("motion") é
    // pensado pra webcam e é uma das causas da imagem "borrada"/em blocos ao
    // compartilhar tela, mesmo com bitrate alto.
    try { stream.getVideoTracks()[0].contentHint = "detail"; } catch (e) {}
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

  // ---------------------------------------------------------------
  // Câmera (webcam) — mesma ideia do compartilhamento de tela, mas
  // usando getUserMedia({video}) em vez de getDisplayMedia.
  // ---------------------------------------------------------------

  async startCamera(deviceId, qualityKey) {
    const preset = this.cfg.CAMERA_PRESETS[qualityKey] || this.cfg.CAMERA_PRESETS[this.cfg.DEFAULT_CAMERA_QUALITY];
    const constraints = {
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.cameraDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId || null;
    this.localCameraStream = stream;
    this.isSharingCamera = true;
    this._applyCameraBitrateCap(preset.maxBitrateKbps);

    stream.getVideoTracks()[0].addEventListener("ended", () => {
      this.stopCamera();
      this.emit("local-camera-ended", {});
    });

    for (const peerId of this.dataConns.keys()) {
      this._callWithCamera(peerId);
    }
    this._broadcast({ type: "camera-started" });
    return stream;
  }

  /** Troca de webcam com a câmera já ativa, sem precisar desligar/religar pros outros. */
  async setCameraDevice(deviceId) {
    if (!this.isSharingCamera) return this.startCamera(deviceId, this.cfg.DEFAULT_CAMERA_QUALITY);
    const preset = this.cfg.CAMERA_PRESETS[this.cfg.DEFAULT_CAMERA_QUALITY];
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
    });
    const oldStream = this.localCameraStream;
    this.localCameraStream = stream;
    this.cameraDeviceId = deviceId;
    const newTrack = stream.getVideoTracks()[0];
    for (const call of this.cameraConnsOut.values()) {
      const sender = call.peerConnection?.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender && newTrack) sender.replaceTrack(newTrack).catch(() => {});
    }
    try { oldStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    return stream;
  }

  _callWithCamera(peerId) {
    if (!this.localCameraStream) return;
    const call = this.peer.call(peerId, this.localCameraStream, { metadata: { kind: "camera" } });
    if (call) this.cameraConnsOut.set(peerId, call);
  }

  stopCamera() {
    if (this.localCameraStream) {
      this.localCameraStream.getTracks().forEach((t) => t.stop());
    }
    for (const call of this.cameraConnsOut.values()) {
      try { call.close(); } catch (e) {}
    }
    this.cameraConnsOut.clear();
    this.localCameraStream = null;
    this.isSharingCamera = false;
    this._broadcast({ type: "camera-stopped" });
  }

  _applyCameraBitrateCap(kbps) {
    for (const call of this.cameraConnsOut.values()) {
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
      // Sem isto, o navegador reduz a resolução sozinho quando o bitrate
      // fica apertado ("maintain-framerate" por padrão em alguns navegadores
      // pra chamadas de vídeo) — pra compartilhamento de tela queremos
      // manter a resolução (texto legível) e sacrificar FPS antes, se precisar.
      params.encodings[0].scaleResolutionDownBy = 1;
      if ("degradationPreference" in params) params.degradationPreference = "maintain-resolution";
      sender.setParameters(params).catch(() => {});
    }
  }

  /**
   * Modo "Automático": mede a saúde da conexão de saída e ajusta o
   * bitrate máximo de vídeo em tempo real. Antes esse método existia
   * mas nunca era chamado — a opção "Automático" ficava travada nos
   * valores padrão de 1080p30 e nunca reagia à rede.
   */
  async autoTuneBitrate(baseQualityKey) {
    if (!this.isSharingScreen || this.screenConnsOut.size === 0) return;
    const health = await this.getOutboundHealth();
    const basePreset = this.cfg.QUALITY_PRESETS[baseQualityKey] || this.cfg.QUALITY_PRESETS["1080p30"];
    const ratios = this.cfg.AUTO_QUALITY_RATIOS || { bad: 0.18, unstable: 0.45, good: 1 };
    let ratio;
    if (health.packetLoss > 0.08 || health.jitter > 0.05) {
      ratio = ratios.bad; // rede ruim: prioriza estabilidade
    } else if (health.packetLoss > 0.03) {
      ratio = ratios.unstable; // rede instável: qualidade média
    } else {
      ratio = ratios.good; // rede boa: mantém o teto do preset
    }
    this._applyBitrateCap(Math.round(basePreset.maxBitrateKbps * ratio));
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
    // _vadCtx é o AudioContext compartilhado (SR.getAudioContext) — não é
    // fechado aqui de propósito, pois ele pode continuar em uso (ou a
    // navegação para outra página, que já acontece logo após destroy(),
    // libera tudo sozinha).
    try { this._micSourceNode?.disconnect(); } catch (e) {}
    try { this._micGainNode?.disconnect(); } catch (e) {}
    try { this._micDestNode?.disconnect(); } catch (e) {}
    try { this.rawMicStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.localMicStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.localScreenStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.localCameraStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.peer?.destroy(); } catch (e) {}
  }
}

window.SRMesh = SRMesh;
