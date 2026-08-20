/**
 * ScreenRoom — Sistema de Nitro
 * Perfil personalizável com badges, bio, foto, banner e fundo customizável
 */
window.SR = window.SR || {};

(function () {
  const ADMIN_PASSWORD = "1605";
  const STORAGE_KEY = "screenroom:nitro:data";
  const BADGES_KEY = "screenroom:nitro:badges";

  // ---------------------------------------------------------------
  // Gerenciamento de dados Nitro
  // ---------------------------------------------------------------

  function getNitroData(userId) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return all[userId] || getDefaultNitro();
    } catch (e) {
      return getDefaultNitro();
    }
  }

  function setNitroData(userId, data) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      all[userId] = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      /* localStorage indisponível */
    }
  }

  function getDefaultNitro() {
    return {
      bio: "",
      profilePic: null, // base64
      banner: null, // base64
      backgroundColor: "#3483fa",
      badges: [], // IDs de badges
      createdAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------
  // Gerenciamento de Badges
  // ---------------------------------------------------------------

  function getAllBadges() {
    try {
      return JSON.parse(localStorage.getItem(BADGES_KEY) || "[]");
    } catch (e) {
      return getDefaultBadges();
    }
  }

  function getDefaultBadges() {
    return [
      {
        id: "old-gen",
        name: "Geração Antiga",
        description: "Esteve desde o início do ScreenRoom",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23FFD700' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='60' fill='%23000' text-anchor='middle' dy='.3em'%3E👑%3C/text%3E%3C/svg%3E",
        color: "#FFD700",
      },
      {
        id: "early-bird",
        name: "Madrugador",
        description: "Entrou no ScreenRoom entre 00:00 e 06:00",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%231a1d29' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='60' fill='%23fff' text-anchor='middle' dy='.3em'%3E🌙%3C/text%3E%3C/svg%3E",
        color: "#1a1d29",
      },
      {
        id: "chat-master",
        name: "Mestre do Chat",
        description: "Enviou mais de 100 mensagens",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%2300a650' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='60' fill='%23fff' text-anchor='middle' dy='.3em'%3E💬%3C/text%3E%3C/svg%3E",
        color: "#00a650",
      },
      {
        id: "screen-sharer",
        name: "Compartilhador de Tela",
        description: "Compartilhou a tela mais de 10 vezes",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%233483fa' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='60' fill='%23fff' text-anchor='middle' dy='.3em'%3E🖥️%3C/text%3E%3C/svg%3E",
        color: "#3483fa",
      },
      {
        id: "camera-star",
        name: "Estrela da Câmera",
        description: "Ligou a câmera em mais de 5 salas",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23f5a623' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='60' fill='%23fff' text-anchor='middle' dy='.3em'%3E📷%3C/text%3E%3C/svg%3E",
        color: "#f5a623",
      },
    ];
  }

  function saveBadges(badges) {
    try {
      localStorage.setItem(BADGES_KEY, JSON.stringify(badges));
    } catch (e) {
      /* localStorage indisponível */
    }
  }

  function createBadge(name, description, icon, color) {
    return {
      id: "badge-" + SR.randomId(8),
      name,
      description,
      icon, // base64 ou URL
      color,
      createdAt: Date.now(),
    };
  }

  function assignBadgeToUser(userId, badgeId) {
    const nitro = getNitroData(userId);
    if (!nitro.badges.includes(badgeId)) {
      nitro.badges.push(badgeId);
      setNitroData(userId, nitro);
    }
  }

  function removeBadgeFromUser(userId, badgeId) {
    const nitro = getNitroData(userId);
    nitro.badges = nitro.badges.filter((id) => id !== badgeId);
    setNitroData(userId, nitro);
  }

  // ---------------------------------------------------------------
  // UI: Modal de Perfil (inspeção)
  // ---------------------------------------------------------------

  function renderProfileModal(userId, userName) {
    const nitro = getNitroData(userId);
    const badges = getAllBadges();
    const userBadges = badges.filter((b) => nitro.badges.includes(b.id));

    const accountAge = Math.floor((Date.now() - nitro.createdAt) / (1000 * 60 * 60 * 24));

    const modal = document.createElement("div");
    modal.className = "modal-backdrop profile-view-backdrop open";
    modal.innerHTML = `
      <div class="modal glass profile-view">
        <button class="btn-icon close-profile" title="Fechar">✕</button>
        
        <div class="profile-banner" style="background: linear-gradient(135deg, ${nitro.backgroundColor}, ${nitro.backgroundColor}dd);">
          ${nitro.banner ? `<img src="${nitro.banner}" alt="Banner" />` : ""}
        </div>

        <div class="profile-content">
          <div class="profile-header">
            <div class="profile-pic-large">
              ${nitro.profilePic ? `<img src="${nitro.profilePic}" alt="Avatar" />` : '<div class="avatar-placeholder">' + SR.initials(userName) + "</div>"}
            </div>
            <div class="profile-info">
              <h2>${SR.escapeHtml(userName)}</h2>
              <p class="profile-label">Na plataforma há ${accountAge} dias</p>
              ${nitro.bio ? `<p class="profile-bio">${SR.escapeHtml(nitro.bio)}</p>` : "<p class='profile-bio empty'>Sem bio</p>"}
            </div>
          </div>

          <div class="profile-badges-section">
            <h3>Badges (${userBadges.length})</h3>
            <div class="profile-badges">
              ${
                userBadges.length > 0
                  ? userBadges
                      .map(
                        (b) =>
                          `<div class="badge-card" style="border-color: ${b.color}; background: ${b.color}11;">
                    ${b.icon.startsWith("data:image") ? `<img src="${b.icon}" alt="${b.name}" />` : `<span class="badge-emoji">${b.icon}</span>`}
                    <div class="badge-text">
                      <strong>${SR.escapeHtml(b.name)}</strong>
                      <small>${SR.escapeHtml(b.description)}</small>
                    </div>
                  </div>`
                      )
                      .join("")
                  : "<p class='no-badges'>Nenhuma badge ainda</p>"
              }
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector(".close-profile").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // ---------------------------------------------------------------
  // UI: Editor de Perfil Nitro
  // ---------------------------------------------------------------

  function renderNitroEditor(userId, userName, onSave) {
    const nitro = getNitroData(userId);
    const badges = getAllBadges();
    const userBadges = nitro.badges;

    const modal = document.createElement("div");
    modal.className = "modal-backdrop nitro-editor-backdrop open";
    modal.innerHTML = `
      <div class="modal glass nitro-editor" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
        <div class="editor-header">
          <h2>Seu Perfil Nitro ✨</h2>
          <button class="btn-icon close-editor" title="Fechar">✕</button>
        </div>

        <div class="editor-section">
          <h3>Bio (até 150 caracteres)</h3>
          <textarea id="bioInput" maxlength="150" placeholder="Conte um pouco sobre você..." style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface-solid); color: var(--text); font-size: 13.5px; resize: vertical; height: 80px; font-family: var(--font-body);">${SR.escapeHtml(nitro.bio)}</textarea>
          <small id="bioCounter">0/150</small>
        </div>

        <div class="editor-section">
          <h3>Foto de Perfil</h3>
          <input type="file" id="profilePicInput" accept="image/*" />
          <small>Máximo 1MB, recomendado: 300x300px</small>
          ${nitro.profilePic ? `<p>✓ Foto salva</p>` : ""}
        </div>

        <div class="editor-section">
          <h3>Banner (topo do perfil)</h3>
          <input type="file" id="bannerInput" accept="image/*" />
          <small>Máximo 2MB, recomendado: 1200x300px</small>
          ${nitro.banner ? `<p>✓ Banner salvo</p>` : ""}
        </div>

        <div class="editor-section">
          <h3>Cor do Fundo</h3>
          <div class="color-picker-row">
            <input type="color" id="bgColorInput" value="${nitro.backgroundColor}" />
            <div class="color-preview" id="colorPreview" style="background: ${nitro.backgroundColor}; width: 60px; height: 40px; border-radius: 8px; border: 1px solid var(--border-strong);"></div>
          </div>
          <div class="color-presets">
            <button type="button" class="color-preset" style="background: #3483fa;" data-color="#3483fa" title="Azul (padrão)"></button>
            <button type="button" class="color-preset" style="background: #ff0000;" data-color="#ff0000" title="Vermelho"></button>
            <button type="button" class="color-preset" style="background: #00a650;" data-color="#00a650" title="Verde"></button>
            <button type="button" class="color-preset" style="background: #f5a623;" data-color="#f5a623" title="Laranja"></button>
            <button type="button" class="color-preset" style="background: #9c27b0;" data-color="#9c27b0" title="Roxo"></button>
            <button type="button" class="color-preset" style="background: #1a1d29;" data-color="#1a1d29" title="Preto"></button>
          </div>
        </div>

        <div class="editor-section">
          <h3>Suas Badges (${userBadges.length})</h3>
          <div class="badges-list">
            ${
              badges.length > 0
                ? badges
                    .map(
                      (b) => `
              <div class="badge-item ${userBadges.includes(b.id) ? "owned" : ""}">
                ${b.icon.startsWith("data:image") ? `<img src="${b.icon}" alt="${b.name}" />` : `<span class="badge-emoji">${b.icon}</span>`}
                <div class="badge-info">
                  <strong>${SR.escapeHtml(b.name)}</strong>
                  <small>${SR.escapeHtml(b.description)}</small>
                </div>
                <span class="badge-status">${userBadges.includes(b.id) ? "✓ Desbloqueada" : "🔒 Bloqueada"}</span>
              </div>
            `
                    )
                    .join("")
                : "<p>Nenhuma badge disponível</p>"
            }
          </div>
        </div>

        <div class="editor-actions">
          <button class="btn btn-primary" id="saveNitroBtn">💾 Salvar Perfil</button>
          <button class="btn btn-ghost" id="cancelNitroBtn">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const bioInput = modal.querySelector("#bioInput");
    const bioCounter = modal.querySelector("#bioCounter");
    const profilePicInput = modal.querySelector("#profilePicInput");
    const bannerInput = modal.querySelector("#bannerInput");
    const bgColorInput = modal.querySelector("#bgColorInput");
    const colorPreview = modal.querySelector("#colorPreview");
    const saveBtn = modal.querySelector("#saveNitroBtn");
    const cancelBtn = modal.querySelector("#cancelNitroBtn");
    const closeBtn = modal.querySelector(".close-editor");

    bioInput.addEventListener("input", () => {
      bioCounter.textContent = bioInput.value.length + "/150";
    });
    bioCounter.textContent = bioInput.value.length + "/150";

    bgColorInput.addEventListener("change", (e) => {
      colorPreview.style.background = e.target.value;
    });

    modal.querySelectorAll(".color-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color;
        bgColorInput.value = color;
        colorPreview.style.background = color;
      });
    });

    const handleClose = () => modal.remove();
    closeBtn.addEventListener("click", handleClose);
    cancelBtn.addEventListener("click", handleClose);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) handleClose();
    });

    saveBtn.addEventListener("click", async () => {
      try {
        let profilePicBase64 = nitro.profilePic;
        if (profilePicInput.files.length > 0) {
          const file = profilePicInput.files[0];
          if (file.size > 1024 * 1024) {
            alert("Foto de perfil muito grande (máx 1MB)");
            return;
          }
          profilePicBase64 = await fileToBase64(file);
        }

        let bannerBase64 = nitro.banner;
        if (bannerInput.files.length > 0) {
          const file = bannerInput.files[0];
          if (file.size > 2 * 1024 * 1024) {
            alert("Banner muito grande (máx 2MB)");
            return;
          }
          bannerBase64 = await fileToBase64(file);
        }

        nitro.bio = bioInput.value.trim();
        nitro.profilePic = profilePicBase64;
        nitro.banner = bannerBase64;
        nitro.backgroundColor = bgColorInput.value;

        setNitroData(userId, nitro);
        handleClose();
        if (onSave) onSave();
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
      }
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------
  // UI: Painel Admin (10 cliques)
  // ---------------------------------------------------------------

  let clickCount = 0;
  let clickTimer = null;

  function startClickDetection() {
    document.addEventListener("click", () => {
      clickCount++;
      if (clickTimer) clearTimeout(clickTimer);
      if (clickCount === 10) {
        showAdminPanel();
        clickCount = 0;
      }
      clickTimer = setTimeout(() => {
        clickCount = 0;
      }, 2000);
    });
  }

  function showAdminPanel() {
    const passwordPrompt = document.createElement("div");
    passwordPrompt.className = "modal-backdrop admin-auth-backdrop open";
    passwordPrompt.innerHTML = `
      <div class="modal glass admin-auth">
        <h3>Painel de Administração</h3>
        <p>Digite a senha para acessar o painel de admin:</p>
        <input type="password" id="adminPassword" placeholder="Senha" autocomplete="off" />
        <div class="admin-auth-actions">
          <button class="btn btn-primary" id="adminLoginBtn">Entrar</button>
          <button class="btn btn-ghost" id="adminCancelBtn">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(passwordPrompt);

    const passwordInput = passwordPrompt.querySelector("#adminPassword");
    const loginBtn = passwordPrompt.querySelector("#adminLoginBtn");
    const cancelBtn = passwordPrompt.querySelector("#adminCancelBtn");

    const handleCancel = () => passwordPrompt.remove();
    cancelBtn.addEventListener("click", handleCancel);

    loginBtn.addEventListener("click", () => {
      if (passwordInput.value === ADMIN_PASSWORD) {
        passwordPrompt.remove();
        showAdminDashboard();
      } else {
        alert("Senha incorreta");
        passwordInput.value = "";
      }
    });

    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loginBtn.click();
    });

    passwordInput.focus();
  }

  function showAdminDashboard() {
    const badges = getAllBadges();

    const modal = document.createElement("div");
    modal.className = "modal-backdrop admin-dashboard-backdrop open";
    modal.innerHTML = `
      <div class="modal glass admin-dashboard" style="max-width: 700px; max-height: 85vh; overflow-y: auto;">
        <div class="admin-header">
          <h2>🔐 Painel de Administração</h2>
          <button class="btn-icon close-admin" title="Fechar">✕</button>
        </div>

        <div class="admin-section">
          <h3>Criar Nova Badge</h3>
          <div class="form-group">
            <input type="text" id="badgeName" placeholder="Nome da badge" maxlength="30" />
            <textarea id="badgeDesc" placeholder="Descrição" maxlength="100" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface-solid); color: var(--text); font-size: 13.5px; resize: vertical; height: 60px;"></textarea>
            <div class="badge-creation-options">
              <label>Tipo de ícone:</label>
              <div class="radio-group">
                <label><input type="radio" name="iconType" value="emoji" checked /> Emoji</label>
                <label><input type="radio" name="iconType" value="image" /> Imagem</label>
              </div>
            </div>
            <input type="text" id="badgeEmoji" placeholder="Emoji (ex: 👑)" maxlength="5" value="✨" />
            <input type="file" id="badgeImage" accept="image/*" style="display: none;" />
            <input type="color" id="badgeColor" value="#3483fa" />
            <button class="btn btn-primary" id="createBadgeBtn">➕ Criar Badge</button>
          </div>
        </div>

        <div class="admin-section">
          <h3>Gerenciar Badges (${badges.length})</h3>
          <div class="badges-admin-list">
            ${
              badges
                .map(
                  (b, idx) => `
              <div class="badge-admin-item">
                <div class="badge-preview">
                  ${b.icon.startsWith("data:image") ? `<img src="${b.icon}" alt="${b.name}" />` : `<span class="badge-emoji-admin">${b.icon}</span>`}
                </div>
                <div class="badge-admin-info">
                  <strong>${SR.escapeHtml(b.name)}</strong>
                  <small>${SR.escapeHtml(b.description)}</small>
                  <div class="badge-color-dot" style="background: ${b.color}; width: 20px; height: 20px; border-radius: 50%; margin-top: 6px;"></div>
                </div>
                <div class="badge-admin-actions">
                  <select class="user-select" data-badge-id="${b.id}">
                    <option value="">Selecione usuário...</option>
                  </select>
                  <button class="btn-icon delete-badge" data-index="${idx}" title="Deletar badge" style="color: #ff0000;">🗑️</button>
                </div>
              </div>
            `
                )
                .join("")
            }
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".close-admin");
    const createBadgeBtn = modal.querySelector("#createBadgeBtn");
    const deleteButtons = modal.querySelectorAll(".delete-badge");
    const iconTypeRadios = modal.querySelectorAll('input[name="iconType"]');
    const badgeEmojiInput = modal.querySelector("#badgeEmoji");
    const badgeImageInput = modal.querySelector("#badgeImage");

    iconTypeRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        if (e.target.value === "emoji") {
          badgeEmojiInput.style.display = "block";
          badgeImageInput.style.display = "none";
        } else {
          badgeEmojiInput.style.display = "none";
          badgeImageInput.style.display = "block";
        }
      });
    });

    closeBtn.addEventListener("click", () => modal.remove());

    createBadgeBtn.addEventListener("click", async () => {
      const name = modal.querySelector("#badgeName").value.trim();
      const desc = modal.querySelector("#badgeDesc").value.trim();
      const color = modal.querySelector("#badgeColor").value;

      if (!name || !desc) {
        alert("Preencha nome e descrição");
        return;
      }

      let icon = "";
      const iconType = modal.querySelector('input[name="iconType"]:checked').value;
      if (iconType === "emoji") {
        icon = badgeEmojiInput.value.trim() || "✨";
      } else {
        if (badgeImageInput.files.length === 0) {
          alert("Selecione uma imagem");
          return;
        }
        const file = badgeImageInput.files[0];
        if (file.size > 500 * 1024) {
          alert("Imagem muito grande (máx 500KB)");
          return;
        }
        icon = await fileToBase64(file);
      }

      const newBadge = createBadge(name, desc, icon, color);
      badges.push(newBadge);
      saveBadges(badges);

      alert("Badge criada com sucesso!");
      modal.remove();
      showAdminDashboard();
    });

    deleteButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index);
        if (confirm("Deletar esta badge?")) {
          badges.splice(idx, 1);
          saveBadges(badges);
          modal.remove();
          showAdminDashboard();
        }
      });
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // ---------------------------------------------------------------
  // Exportar API
  // ---------------------------------------------------------------

  window.SR.Nitro = {
    getNitroData,
    setNitroData,
    getDefaultNitro,
    getAllBadges,
    getDefaultBadges,
    saveBadges,
    createBadge,
    assignBadgeToUser,
    removeBadgeFromUser,
    renderProfileModal,
    renderNitroEditor,
    startClickDetection,
    fileToBase64,
  };
})();
