(function () {
  const $ = (id) => document.getElementById(id);
  const grid = $("serverGrid");
  const inlineError = $("inlineError");

  function toast(msg) {
    const t = $("fpToast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  }

  function avatarStyle(dataUrl) {
    return dataUrl ? `background-image:url('${dataUrl}')` : "";
  }

  function renderServers(list) {
    const publicServers = list.filter((s) => s.public);
    if (publicServers.length === 0) {
      grid.innerHTML = `<div class="fp-empty">Nenhum servidor público ainda. Crie o primeiro!</div>`;
      return;
    }
    grid.innerHTML = publicServers
      .map((s) => {
        const initials = window.SR.initials(s.name);
        return `
        <div class="fp-card" data-id="${s.id}">
          <div class="fp-card-banner" style="${avatarStyle(s.banner)}"></div>
          <div class="fp-card-body">
            <div class="fp-card-avatar" style="${avatarStyle(s.avatar)}">${s.avatar ? "" : window.SR.escapeHtml(initials)}</div>
            <h4 class="fp-card-name">${window.SR.escapeHtml(s.name)}</h4>
            <p class="fp-card-desc">${window.SR.escapeHtml(s.description || "Sem descrição.")}</p>
            <div class="fp-card-foot">
              <div>
                <div class="fp-card-members">Até ${s.memberLimit} membros</div>
                <div class="fp-card-code">Código: ${s.code}</div>
              </div>
              <button class="btn btn-primary btn-join" data-code="${s.code}">Entrar</button>
            </div>
          </div>
        </div>`;
      })
      .join("");

    grid.querySelectorAll(".btn-join").forEach((btn) => {
      btn.addEventListener("click", () => enterByCode(btn.dataset.code));
    });
  }

  async function loadServers() {
    try {
      const list = await window.SR.listServers();
      renderServers(list);
    } catch (e) {
      grid.innerHTML = `<div class="fp-empty">Não foi possível carregar a lista (${window.SR.escapeHtml(e.message)}).</div>`;
    }
  }

  async function enterByCode(code) {
    inlineError.textContent = "";
    if (!window.SR.isValidRoomCode(code)) {
      inlineError.textContent = "Código inválido. Deve ter 5 caracteres.";
      return;
    }
    try {
      const server = await window.SR.getServerByCode(code);
      if (!server) {
        inlineError.textContent = "Nenhum servidor encontrado com esse código.";
        return;
      }
      location.href = `room.html?code=${server.code}&server=${server.id}`;
    } catch (e) {
      inlineError.textContent = "Erro ao buscar servidor: " + e.message;
    }
  }

  $("btnJoinCode").addEventListener("click", () => enterByCode($("codeInput").value));
  $("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") enterByCode($("codeInput").value);
  });
  $("codeInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // ---------------- Criar servidor ----------------
  const createModal = $("createModal");
  $("btnCreate").addEventListener("click", () => {
    $("createStep1").style.display = "block";
    $("createStep2").style.display = "none";
    $("createError").textContent = "";
    createModal.classList.add("open");
  });
  $("btnCreateCancel").addEventListener("click", () => createModal.classList.remove("open"));
  $("btnCreateClose").addEventListener("click", () => {
    createModal.classList.remove("open");
    loadServers();
  });

  let lastCreated = null;
  $("btnCreateGo").addEventListener("click", async () => {
    const name = $("csName").value.trim();
    const err = $("createError");
    err.textContent = "";
    if (!name) {
      err.textContent = "Dê um nome ao servidor.";
      return;
    }
    $("btnCreateGo").disabled = true;
    $("btnCreateGo").textContent = "Criando…";
    try {
      const server = await window.SR.createServer({
        name,
        description: $("csDesc").value,
        isPublic: $("csPublic").checked,
        memberLimit: $("csLimit").value,
        avatarFile: $("csAvatar").files[0],
        bannerFile: $("csBanner").files[0],
      });
      lastCreated = server;
      $("createdCode").textContent = server.code;
      $("createStep1").style.display = "none";
      $("createStep2").style.display = "block";
    } catch (e) {
      err.textContent = "Erro ao criar servidor: " + e.message;
    } finally {
      $("btnCreateGo").disabled = false;
      $("btnCreateGo").textContent = "Criar servidor";
    }
  });
  $("btnCreateEnter").addEventListener("click", () => {
    if (lastCreated) location.href = `room.html?code=${lastCreated.code}&server=${lastCreated.id}`;
  });

  // ---------------- Perfil ----------------
  const profileModal = $("profileModal");
  async function openProfile() {
    profileModal.classList.add("open");
    $("profileError").textContent = "";
    try {
      const p = await window.SR.getMyProfile();
      $("pfName").value = p.name || "";
      $("pfDesc").value = p.description || "";
      profileModal.dataset.avatar = p.avatar || "";
      profileModal.dataset.banner = p.banner || "";
      refreshChip(p);
    } catch (e) {
      $("profileError").textContent = "Não foi possível carregar seu perfil: " + e.message;
    }
  }
  function refreshChip(p) {
    $("myNameChip").textContent = p.name || "Meu perfil";
    const chip = $("myAvatarChip");
    if (p.avatar) {
      chip.style.backgroundImage = `url('${p.avatar}')`;
      chip.textContent = "";
    } else {
      chip.style.backgroundImage = "";
      chip.textContent = window.SR.initials(p.name || "?");
    }
  }
  $("btnProfile").addEventListener("click", openProfile);
  $("btnProfileCancel").addEventListener("click", () => profileModal.classList.remove("open"));
  $("btnProfileSave").addEventListener("click", async () => {
    const err = $("profileError");
    err.textContent = "";
    $("btnProfileSave").disabled = true;
    $("btnProfileSave").textContent = "Salvando…";
    try {
      const p = await window.SR.saveMyProfile({
        name: $("pfName").value,
        description: $("pfDesc").value,
        avatarFile: $("pfAvatar").files[0],
        bannerFile: $("pfBanner").files[0],
        keepAvatar: profileModal.dataset.avatar,
        keepBanner: profileModal.dataset.banner,
      });
      refreshChip(p);
      profileModal.classList.remove("open");
      toast("Perfil salvo!");
    } catch (e) {
      err.textContent = "Erro ao salvar: " + e.message;
    } finally {
      $("btnProfileSave").disabled = false;
      $("btnProfileSave").textContent = "Salvar perfil";
    }
  });

  // init
  window.SR.getMyProfile().then(refreshChip).catch(() => {});
  loadServers();
})();
