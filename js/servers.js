/**
 * FpyyCord — servidores e perfis.
 * Guarda tudo em data/servers.json e data/profiles.json via js/gh-db.js.
 */
window.SR = window.SR || {};

(function () {
  const ghdb = () => window.SR.ghdb;
  const cfg = () => window.SR_CONFIG.GITHUB_DB;

  // ---------------------------------------------------------------
  // Identidade local do dispositivo (não é login de verdade — é só um
  // ID aleatório salvo no navegador, igual ao nome salvo do ScreenRoom).
  // ---------------------------------------------------------------
  function getDeviceId() {
    let id;
    try {
      id = localStorage.getItem("fpycord:deviceId");
    } catch (e) {}
    if (!id) {
      id = window.SR.randomId(16);
      try {
        localStorage.setItem("fpycord:deviceId", id);
      } catch (e) {}
    }
    return id;
  }

  // ---------------------------------------------------------------
  // Imagens: redimensiona/comprime antes de guardar como base64 dentro
  // do JSON (não há hospedagem de imagem separada — tudo vai pro git).
  // ---------------------------------------------------------------
  function fileToResizedDataUrl(file, maxW, maxH, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const isGif = file.type === "image/gif";
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
      reader.onload = () => {
        if (isGif) {
          // GIFs animados: redimensionar via canvas perderia a animação,
          // então mantemos o arquivo original (peso maior, mas anima).
          resolve(reader.result);
          return;
        }
        const img = new Image();
        img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
        img.onload = () => {
          let { width, height } = img;
          const ratio = Math.min(1, maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const MAX_IMAGE_BYTES = 900 * 1024; // ~900KB depois de base64 — trava de segurança

  function checkImageSize(dataUrl, label) {
    if (dataUrl && dataUrl.length > MAX_IMAGE_BYTES) {
      throw new Error(`${label} muito grande. Escolha uma imagem/gif menor.`);
    }
  }

  // ---------------------------------------------------------------
  // Perfis
  // ---------------------------------------------------------------
  async function getMyProfile() {
    const id = getDeviceId();
    const { data } = await ghdb().getJSON(cfg().PATH_PROFILES, {});
    return (
      data[id] || {
        id,
        name: window.SR.getSavedName() || "Sem nome",
        avatar: null,
        banner: null,
        description: "",
      }
    );
  }

  async function getProfile(id) {
    const { data } = await ghdb().getJSON(cfg().PATH_PROFILES, {});
    return data[id] || null;
  }

  async function saveMyProfile({ name, description, avatarFile, bannerFile, keepAvatar, keepBanner }) {
    const id = getDeviceId();
    const avatar = avatarFile ? await fileToResizedDataUrl(avatarFile, 256, 256) : keepAvatar || null;
    const banner = bannerFile ? await fileToResizedDataUrl(bannerFile, 960, 320) : keepBanner || null;
    checkImageSize(avatar, "Foto de perfil");
    checkImageSize(banner, "Banner");

    const profile = {
      id,
      name: (name || "Sem nome").trim().slice(0, 30),
      description: (description || "").trim().slice(0, 200),
      avatar,
      banner,
      updatedAt: new Date().toISOString(),
    };

    await ghdb().readModifyWrite(
      cfg().PATH_PROFILES,
      {},
      (data) => {
        data[id] = profile;
        return data;
      },
      `Atualiza perfil de ${profile.name}`
    );

    window.SR.saveName(profile.name);
    return profile;
  }

  // ---------------------------------------------------------------
  // Servidores
  // ---------------------------------------------------------------
  async function listServers() {
    const { data } = await ghdb().getJSON(cfg().PATH_SERVERS, {});
    return Object.values(data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async function getServerByCode(code) {
    if (!code) return null;
    code = code.trim().toUpperCase();
    const { data } = await ghdb().getJSON(cfg().PATH_SERVERS, {});
    return Object.values(data).find((s) => s.code === code) || null;
  }

  async function getServer(id) {
    const { data } = await ghdb().getJSON(cfg().PATH_SERVERS, {});
    return data[id] || null;
  }

  async function createServer({ name, description, isPublic, memberLimit, avatarFile, bannerFile }) {
    const avatar = await fileToResizedDataUrl(avatarFile, 256, 256);
    const banner = await fileToResizedDataUrl(bannerFile, 960, 320);
    checkImageSize(avatar, "Ícone do servidor");
    checkImageSize(banner, "Banner do servidor");

    const server = {
      id: window.SR.randomId(10),
      name: (name || "Servidor sem nome").trim().slice(0, 60),
      description: (description || "").trim().slice(0, 200),
      code: window.SR.generateRoomCode(),
      public: !!isPublic,
      memberLimit: Math.max(2, Math.min(50, parseInt(memberLimit, 10) || window.SR_CONFIG.MAX_PARTICIPANTS)),
      avatar,
      banner,
      ownerId: getDeviceId(),
      createdAt: new Date().toISOString(),
    };

    await ghdb().readModifyWrite(
      cfg().PATH_SERVERS,
      {},
      (data) => {
        data[server.id] = server;
        return data;
      },
      `Cria servidor "${server.name}"`
    );

    return server;
  }

  async function updateServer(id, patch) {
    let updated = null;
    await ghdb().readModifyWrite(
      cfg().PATH_SERVERS,
      {},
      (data) => {
        if (!data[id]) throw new Error("Servidor não encontrado.");
        data[id] = { ...data[id], ...patch };
        updated = data[id];
        return data;
      },
      `Atualiza servidor ${id}`
    );
    return updated;
  }

  async function deleteServer(id) {
    await ghdb().readModifyWrite(
      cfg().PATH_SERVERS,
      {},
      (data) => {
        delete data[id];
        return data;
      },
      `Remove servidor ${id}`
    );
  }

  async function deleteProfile(id) {
    await ghdb().readModifyWrite(
      cfg().PATH_PROFILES,
      {},
      (data) => {
        delete data[id];
        return data;
      },
      `Remove perfil ${id}`
    );
  }

  window.SR.getDeviceId = getDeviceId;
  window.SR.getMyProfile = getMyProfile;
  window.SR.getProfile = getProfile;
  window.SR.saveMyProfile = saveMyProfile;
  window.SR.listServers = listServers;
  window.SR.getServerByCode = getServerByCode;
  window.SR.getServer = getServer;
  window.SR.createServer = createServer;
  window.SR.updateServer = updateServer;
  window.SR.deleteServer = deleteServer;
  window.SR.deleteProfile = deleteProfile;
})();
