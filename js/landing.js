/**
 * ScreenRoom — landing page
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  const joinBox = $("#joinBox");
  const codeInput = $("#codeInput");
  const btnCreate = $("#btnCreate");
  const btnJoinToggle = $("#btnJoinToggle");
  const btnJoinGo = $("#btnJoinGo");
  const inlineError = $("#inlineError");

  const nameModal = $("#nameModal");
  const nameInput = $("#nameInput");
  const nameConfirm = $("#nameConfirm");
  const nameHint = $("#nameHint");

  let pendingAction = null; // { mode: 'host'|'join', code }

  function showError(msg) {
    inlineError.textContent = msg;
    inlineError.classList.add("show");
    setTimeout(() => inlineError.classList.remove("show"), 4000);
  }

  function openNameModal(hint) {
    nameHint.textContent = hint;
    const saved = SR.getSavedName();
    nameInput.value = saved;
    nameModal.classList.add("open");
    setTimeout(() => nameInput.focus(), 50);
  }

  function closeNameModal() {
    nameModal.classList.remove("open");
  }

  function proceed() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    SR.saveName(name);
    closeNameModal();

    const issues = SR.detectBrowserSupport();
    if (issues.length) {
      showError(issues[0]);
      return;
    }

    if (pendingAction.mode === "host") {
      const code = SR.generateRoomCode();
      sessionStorage.setItem("screenroom:role", "host");
      window.location.href = `room.html?code=${code}`;
    } else {
      sessionStorage.setItem("screenroom:role", "guest");
      window.location.href = `room.html?code=${pendingAction.code}`;
    }
  }

  btnCreate.addEventListener("click", () => {
    pendingAction = { mode: "host" };
    openNameModal("Esse nome vai aparecer para todos na sua sala.");
  });

  btnJoinToggle.addEventListener("click", () => {
    joinBox.classList.toggle("open");
    if (joinBox.classList.contains("open")) codeInput.focus();
  });

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  });

  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnJoinGo.click();
  });

  btnJoinGo.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!SR.isValidRoomCode(code)) {
      showError("Digite um código válido de 5 caracteres.");
      return;
    }
    pendingAction = { mode: "join", code };
    openNameModal(`Você vai entrar na sala ${code}.`);
  });

  nameConfirm.addEventListener("click", proceed);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") proceed();
  });
  nameModal.addEventListener("click", (e) => {
    if (e.target === nameModal) closeNameModal();
  });

  // Se veio de um link direto tipo index.html?code=XXXXX, pré-preenche o join.
  const params = new URLSearchParams(location.search);
  if (params.get("code")) {
    joinBox.classList.add("open");
    codeInput.value = params.get("code").toUpperCase().slice(0, 5);
  }

  // room.html redireciona para cá com ?error=invalid-code quando o código na
  // URL é inválido — antes esse erro era descartado e o usuário só via a
  // landing normal, sem entender por que caiu ali.
  if (params.get("error") === "invalid-code") {
    joinBox.classList.add("open");
    showError("Esse link tem um código de sala inválido. Digite o código manualmente.");
  }
})();
