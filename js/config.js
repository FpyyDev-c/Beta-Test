/**
 * ScreenRoom — configuração centralizada.
 * Altere aqui os parâmetros do app (limite de participantes, prefixo de sala, etc).
 * Não há valores sensíveis aqui: tudo é público por natureza (app 100% client-side).
 */
window.SR_CONFIG = {
  // Limite de participantes por sala.
  MAX_PARTICIPANTS: 10,

  // Prefixo usado no ID público do PeerJS para reduzir colisão com outros
  // usuários da rede pública do PeerJS (que é compartilhada globalmente).
  ROOM_PREFIX: "screenroom-v1-",

  // Caracteres usados para gerar o código de 5 caracteres da sala.
  // Removemos 0/O, 1/I/L e outros pares fáceis de confundir.
  ROOM_CODE_CHARS: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
  ROOM_CODE_LENGTH: 5,

  // Servidor público do PeerJS (signaling via WebSocket, mantido pela equipe do PeerJS).
  // Não requer conta nem configuração. Veja https://peerjs.com
  PEERJS_OPTIONS: {
    debug: 1,
  },

  // STUN públicos (Google). Suficientes para a maioria das redes domésticas/corporativas.
  // TURN NÃO está incluso por padrão: TURN exige um provedor com credenciais
  // (não existe TURN público, gratuito e confiável). Veja instruções no README
  // sobre como adicionar um TURN gratuito (ex: Metered.ca) se pessoas atrás de
  // NAT/firewall restritivo não conseguirem se conectar.
  ICE_SERVERS: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Exemplo de como adicionar TURN (ver README, seção "TURN opcional"):
    // { urls: "turn:SEU_HOST:3478", username: "SEU_USUARIO", credential: "SUA_SENHA" },
  ],

  // Presets de qualidade para compartilhamento de tela.
  // Bitrates foram revistos para cima: os valores antigos (principalmente em
  // 1440p60/4k60) eram baixos demais para a resolução/taxa de quadros pedida,
  // então o encoder do navegador comprimia agressivamente e a imagem saía
  // borrada/blocada mesmo com "4K 60 FPS" selecionado. Os valores abaixo são
  // próximos do que o Discord/YouTube usam para as mesmas resoluções.
  QUALITY_PRESETS: {
    "720p30":  { width: 1280, height: 720,  frameRate: 30, maxBitrateKbps: 3000,  label: "720p 30 FPS" },
    "1080p30": { width: 1920, height: 1080, frameRate: 30, maxBitrateKbps: 6000,  label: "1080p 30 FPS" },
    "1080p60": { width: 1920, height: 1080, frameRate: 60, maxBitrateKbps: 9000,  label: "1080p 60 FPS" },
    "1440p60": { width: 2560, height: 1440, frameRate: 60, maxBitrateKbps: 16000, label: "1440p 60 FPS" },
    "4k60":    { width: 3840, height: 2160, frameRate: 60, maxBitrateKbps: 30000, label: "4K 60 FPS" },
    "auto":    { width: 1920, height: 1080, frameRate: 30, maxBitrateKbps: 6000,  label: "Automático" },
  },
  DEFAULT_QUALITY: "auto",

  // Escala de bitrate usada pelo modo "Automático" (autoTuneBitrate em mesh.js).
  // Antes esses valores eram fixos e baixos (1000/2200/3500) — agora escalam
  // a partir do preset selecionado, então "Automático" numa rede boa entrega
  // bem mais que 3.5 Mbps quando a qualidade pedida é 1440p/4K.
  AUTO_QUALITY_RATIOS: { bad: 0.18, unstable: 0.45, good: 1 },

  // Presets de câmera (webcam). Resoluções mais comuns de webcam — sem 4K
  // porque poucas webcams de verdade suportam isso, diferente da captura de tela.
  CAMERA_PRESETS: {
    "360p":  { width: 640,  height: 360,  frameRate: 30, maxBitrateKbps: 400,  label: "360p" },
    "480p":  { width: 854,  height: 480,  frameRate: 30, maxBitrateKbps: 800,  label: "480p" },
    "720p":  { width: 1280, height: 720,  frameRate: 30, maxBitrateKbps: 1800, label: "720p (recomendado)" },
    "1080p": { width: 1920, height: 1080, frameRate: 30, maxBitrateKbps: 3000, label: "1080p" },
  },
  DEFAULT_CAMERA_QUALITY: "720p",

  // Configurações padrão de áudio (captura do microfone).
  DEFAULT_AUDIO_SETTINGS: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // "Isolamento de voz": filtro (corte de graves/agudos fora da faixa da
    // voz humana + leve compressão dinâmica) aplicado no navegador antes de
    // enviar o áudio. É uma aproximação por processamento de sinal, não uma
    // supressão de ruído por IA como a de apps dedicados — mas ajuda bastante
    // com ventilador, teclado, ruído de fundo constante, etc.
    voiceIsolation: false,
    micVolume: 1, // 1 = 100%. Faixa permitida: MIC_VOLUME_MIN..MIC_VOLUME_MAX
  },
  MIC_VOLUME_MIN: 0,
  MIC_VOLUME_MAX: 2, // até 200%
  PEER_VOLUME_MIN: 0,
  PEER_VOLUME_MAX: 2, // até 200% por participante/compartilhamento
};
