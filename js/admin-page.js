(function () {
  const $ = (id) => document.getElementById(id);

  // Gate simples por senha — ver aviso em js/config.js sobre isso não ser
  // segurança de verdade (o código-fonte é público).
  function checkSession() {
    try {
      return sessionStorage.getItem("fpycord:admin") === "1";
    } catch (e) {
      return false;
    }
  }
  function openPanel() {
    $("gate").style.display = "none";
    $("panel").style.display = "block";
    loadAll();
  }
  $("btnGateGo").addEventListener("click", () => {
    const pass = $("gatePass").value;
    if (pass === window.SR_CONFIG.ADMIN_PASSWORD) {
      try { sessionStorage.setItem("fpycord:admin", "1"); } catch (e) {}
      openPanel();
    } else {
      $("gateError").textContent = "Senha incorreta.";
    }
  });
  $("gatePass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnGateGo").click();
  });
  if (checkSession()) openPanel();

  function avatarCell(dataUrl, name) {
    const bg = dataUrl ? `background-image:url('${dataUrl}')` : "";
    return `<div class="fp-avatar-sm" style="width:34px;height:34px;font-size:13px;${bg}">${dataUrl ? "" : window.SR.escapeHtml(window.SR.initials(name))}</div>`;
  }

  async function loadAll() {
    const err = $("adminError");
    err.textContent = "";
    try {
      const [servers, profilesResult] = await Promise.all([
        window.SR.listServers(),
        window.SR.ghdb.getJSON(window.SR_CONFIG.GITHUB_DB.PATH_PROFILES, {}),
      ]);
      renderServers(servers);
      renderProfiles(Object.values(profilesResult.data));
    } catch (e) {
      err.textContent = "Erro ao carregar dados: " + e.message;
    }
  }

  function renderServers(servers) {
    $("serverCount").textContent = servers.length;
    $("serverTbody").innerHTML = servers
      .map(
        (s) => `
      <tr data-id="${s.id}">
        <td>${avatarCell(s.avatar, s.name)}</td>
        <td>${window.SR.escapeHtml(s.name)}</td>
        <td style="font-family:var(--font-mono);">${s.code}</td>
        <td><span class="fp-pill ${s.public ? "pub" : "priv"}">${s.public ? "Público" : "Privado"}</span></td>
        <td>${s.memberLimit}</td>
        <td>${s.createdAt ? new Date(s.createdAt).toLocaleDateString("pt-BR") : "-"}</td>
        <td>
          <button class="btn btn-ghost btn-sm btn-toggle-vis">${s.public ? "Tornar privado" : "Tornar público"}</button>
          <button class="btn btn-ghost btn-sm btn-del-server" style="color:var(--danger);">Excluir</button>
        </td>
      </tr>`
      )
      .join("");

    $("serverTbody").querySelectorAll(".btn-toggle-vis").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        const s = servers.find((x) => x.id === id);
        try {
          await window.SR.updateServer(id, { public: !s.public });
          loadAll();
        } catch (err) {
          $("adminError").textContent = "Erro: " + err.message;
        }
      })
    );
    $("serverTbody").querySelectorAll(".btn-del-server").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        if (!confirm("Excluir este servidor? Essa ação não pode ser desfeita.")) return;
        try {
          await window.SR.deleteServer(id);
          loadAll();
        } catch (err) {
          $("adminError").textContent = "Erro: " + err.message;
        }
      })
    );
  }

  function renderProfiles(profiles) {
    $("profileCount").textContent = profiles.length;
    $("profileTbody").innerHTML = profiles
      .map(
        (p) => `
      <tr data-id="${p.id}">
        <td>${avatarCell(p.avatar, p.name)}</td>
        <td>${window.SR.escapeHtml(p.name)}</td>
        <td>${window.SR.escapeHtml(p.description || "")}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);">${p.id}</td>
        <td><button class="btn btn-ghost btn-sm btn-del-profile" style="color:var(--danger);">Remover</button></td>
      </tr>`
      )
      .join("");

    $("profileTbody").querySelectorAll(".btn-del-profile").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        if (!confirm("Remover este perfil?")) return;
        try {
          await window.SR.deleteProfile(id);
          loadAll();
        } catch (err) {
          $("adminError").textContent = "Erro: " + err.message;
        }
      })
    );
  }
})();
