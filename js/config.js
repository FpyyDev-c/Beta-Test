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
  QUALITY_PRESETS: {
    "720p30":  { width: 1280, height: 720,  frameRate: 30, maxBitrateKbps: 2000, label: "720p 30 FPS" },
    "1080p30": { width: 1920, height: 1080, frameRate: 30, maxBitrateKbps: 3500, label: "1080p 30 FPS" },
    "1080p60": { width: 1920, height: 1080, frameRate: 60, maxBitrateKbps: 5000, label: "1080p 60 FPS" },
    "1440p60": { width: 2560, height: 1440, frameRate: 60, maxBitrateKbps: 9000, label: "1440p 60 FPS" },
    "4k60":    { width: 3840, height: 2160, frameRate: 60, maxBitrateKbps: 18000, label: "4K 60 FPS" },
    "auto":    { width: 1920, height: 1080, frameRate: 30, maxBitrateKbps: 3500, label: "Automático" },
  },
  DEFAULT_QUALITY: "auto",
};
