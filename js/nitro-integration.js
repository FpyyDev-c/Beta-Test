/**
 * ScreenRoom — Nitro Integration
 * Integra o sistema Nitro com a sala (botão de perfil e inspeção)
 */

(function() {
  function setupNitroIntegration() {
    const btnProfile = document.querySelector('#btnProfile');
    if (!btnProfile) {
      setTimeout(setupNitroIntegration, 500);
      return;
    }

    // Iniciar detecção de 10 cliques para abrir painel admin
    SR.Nitro.startClickDetection();

    // Obter o userId da sessão
    const userName = SR.getSavedName();
    let userId = sessionStorage.getItem('screenroom:userId');
    
    if (!userId) {
      userId = 'user-' + SR.randomId(12);
      sessionStorage.setItem('screenroom:userId', userId);
    }

    // Botão para abrir editor de perfil
    btnProfile.addEventListener('click', () => {
      SR.Nitro.renderNitroEditor(userId, userName);
    });

    // Configurar inspeção de perfil de outros participantes
    setupProfileInspection(userId);
  }

  function setupProfileInspection(currentUserId) {
    const participantList = document.querySelector('#participantList');
    if (!participantList) {
      setTimeout(() => setupProfileInspection(currentUserId), 500);
      return;
    }

    const observer = new MutationObserver(() => {
      attachProfileListeners(currentUserId);
    });

    observer.observe(participantList, {
      childList: true,
      subtree: true,
    });

    attachProfileListeners(currentUserId);
  }

  function attachProfileListeners(currentUserId) {
    const participants = document.querySelectorAll('.participant');
    participants.forEach((el) => {
      if (el.dataset.nitroSetup === 'true') return;
      el.dataset.nitroSetup = 'true';

      el.addEventListener('click', (e) => {
        if (e.target.closest('.p-kick')) return;

        const pName = el.querySelector('.p-name');
        const userName = pName ? pName.textContent.trim() : 'Usuário';
        const userId = 'user-' + userName.toLowerCase().replace(/\s+/g, '-');
        
        SR.Nitro.renderProfileModal(userId, userName);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNitroIntegration);
  } else {
    setupNitroIntegration();
  }
})();
