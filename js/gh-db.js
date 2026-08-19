/**
 * FpyyCord — "banco de dados" via GitHub.
 *
 * Como o site é 100% estático (GitHub Pages, sem backend), a lista de
 * servidores e os perfis precisam ficar em algum lugar que TODO MUNDO
 * consiga ler e escrever. A solução escolhida foi usar o próprio
 * repositório do GitHub como banco de dados: os dados ficam em arquivos
 * JSON (ex: data/servers.json) e são lidos/gravados pela API do GitHub
 * (Contents API).
 *
 * ⚠️ AVISO DE SEGURANÇA — leia isto:
 * Para GRAVAR dados (criar servidor, editar perfil, etc.) é preciso um
 * token de acesso pessoal do GitHub (Personal Access Token) com permissão
 * de escrita no repositório. Esse token fica dentro do js/config.js, que é
 * um arquivo público — QUALQUER PESSOA que acessar o site pode abrir o
 * código-fonte e ver esse token, e usá-lo para alterar/apagar coisas no seu
 * repositório (ou em outros repositórios que o token tenha acesso).
 *
 * Para reduzir o risco:
 *  - Crie um token do tipo "Fine-grained personal access token" em
 *    https://github.com/settings/tokens (não use um token "classic").
 *  - Dê acesso SOMENTE ao repositório do FpyyCord (nenhum outro).
 *  - Dê permissão SOMENTE de "Contents: Read and write" (nada mais).
 *  - Não use esse token pra mais nada, e troque-o (revogue e crie outro)
 *    de tempos em tempos, ou se perceber uso estranho no repositório.
 *  - Isso continua sendo um risco real: alguém mal-intencionado pode
 *    sobrescrever data/servers.json com lixo, ou até apagar o conteúdo do
 *    repositório caso o token tenha mais permissão do que devia. Foi uma
 *    troca consciente para não depender de nenhum serviço externo.
 */
window.SR = window.SR || {};

(function () {
  const API = "https://api.github.com";

  function cfg() {
    return window.SR_CONFIG.GITHUB_DB;
  }

  function headers() {
    const c = cfg();
    return {
      Authorization: `Bearer ${c.TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  /**
   * Lê um arquivo JSON do repositório.
   * Retorna { data, sha } — sha é necessário para poder sobrescrever depois.
   * Se o arquivo ainda não existe, retorna { data: fallback, sha: null }.
   */
  async function getJSON(path, fallback) {
    const c = cfg();
    if (!c.ENABLED) throw new Error("GITHUB_DB não está configurado (veja js/config.js).");
    const url = `${API}/repos/${c.OWNER}/${c.REPO}/contents/${path}?ref=${c.BRANCH}&_=${Date.now()}`;
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (res.status === 404) {
      return { data: fallback, sha: null };
    }
    if (!res.ok) {
      throw new Error(`Erro ao ler ${path}: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    let data;
    try {
      data = JSON.parse(base64ToUtf8(json.content));
    } catch (e) {
      data = fallback;
    }
    return { data, sha: json.sha };
  }

  /**
   * Grava (cria ou atualiza) um arquivo JSON no repositório.
   * Tenta de novo automaticamente uma vez se detectar conflito de versão
   * (409/422 — outra pessoa gravou ao mesmo tempo), buscando o sha mais
   * recente e deixando quem chamou decidir se quer mesclar e tentar de novo.
   */
  async function putJSON(path, data, message, sha) {
    const c = cfg();
    if (!c.ENABLED) throw new Error("GITHUB_DB não está configurado (veja js/config.js).");
    const url = `${API}/repos/${c.OWNER}/${c.REPO}/contents/${path}`;
    const body = {
      message: message || `Atualiza ${path}`,
      content: utf8ToBase64(JSON.stringify(data, null, 2)),
      branch: c.BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const conflict = res.status === 409 || res.status === 422;
      const err = new Error(`Erro ao gravar ${path}: ${res.status} ${res.statusText} ${errBody}`);
      err.conflict = conflict;
      throw err;
    }
    const json = await res.json();
    return json.content.sha;
  }

  /**
   * Lê, aplica `mutateFn(data)` (que deve retornar os novos dados) e grava.
   * Se der conflito de sha (outra pessoa gravou entre a leitura e a
   * escrita), tenta mais uma vez do zero antes de desistir.
   */
  async function readModifyWrite(path, fallback, mutateFn, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, sha } = await getJSON(path, fallback);
      const next = mutateFn(structuredClone(data));
      try {
        await putJSON(path, next, message, sha);
        return next;
      } catch (e) {
        if (e.conflict && attempt < 2) continue;
        throw e;
      }
    }
    throw new Error(`Não foi possível gravar ${path} após múltiplas tentativas.`);
  }

  window.SR.ghdb = { getJSON, putJSON, readModifyWrite };
})();
