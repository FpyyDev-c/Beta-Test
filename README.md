# 🖥️ ScreenRoom

Compartilhe sua tela. Converse. Conecte-se.

ScreenRoom é uma alternativa simples ao compartilhamento de tela do Discord: você cria uma sala, recebe um código de 5 caracteres, e qualquer pessoa com esse código entra na sua sala e vê sua tela em tempo real — direto do navegador, sem instalar nada.

Este projeto é **100% estático** (HTML + CSS + JavaScript puro) e feito para rodar **de graça no GitHub Pages**, sem backend próprio, sem `.env`, sem banco de dados e sem terminal depois da publicação.

---

## ⚠️ Leia isto primeiro: como isso funciona sem servidor próprio

Compartilhamento de tela em tempo real usa uma tecnologia chamada **WebRTC**, que conecta dois navegadores diretamente um ao outro (ponto a ponto — a tela nunca passa por nenhum servidor). Mas, para dois navegadores se encontrarem pela primeira vez, é necessário um pequeno "cartório" de apresentação, chamado **signaling**.

Como o GitHub Pages só serve arquivos estáticos (não roda um servidor Node.js), o ScreenRoom usa a **rede pública e gratuita de signaling do [PeerJS](https://peerjs.com)** para essa apresentação inicial. Isso significa:

- ✅ Você não precisa criar conta em nenhum lugar para o signaling funcionar.
- ✅ Você não precisa hospedar nada além do GitHub Pages.
- ✅ O vídeo e o áudio da tela compartilhada vão **direto de um navegador para o outro** (P2P) — o servidor de signaling só ajuda a "apresentar" os dois lados.
- ⚠️ Por ser um serviço público e gratuito mantido pela comunidade do PeerJS (não pela Anthropic nem por você), ele não tem garantia de disponibilidade 100% do tempo. Para uso pessoal, entre amigos, em equipes pequenas ou para estudos, funciona muito bem. Se um dia esse serviço público ficar fora do ar, veja a seção **"Rodando seu próprio signaling (opcional)"** mais abaixo.
- ⚠️ Em redes com firewall/NAT muito restritivo (comum em algumas redes corporativas), a conexão direta pode falhar sem um servidor **TURN**. Isso é explicado na seção de TURN abaixo — é opcional e só é necessário se alguém não conseguir conectar.

Nada disso exige nenhuma ação sua além de publicar os arquivos. O projeto já vem configurado e funcionando.

---

## ✨ Funcionalidades

- Criar sala com código de 5 caracteres, gerado automaticamente
- Entrar em sala existente digitando o código
- Compartilhamento de tela (tela inteira, janela ou aba), com opção de áudio do sistema
- Menu de qualidade: 720p30, 1080p30, 1080p60, 1440p60, 4K60 e Automático (adapta bitrate conforme a rede) — bitrates revisados para cima e `contentHint`/`degradationPreference` ajustados para manter a nitidez em resoluções altas
- **Câmera (webcam)**: ligar/desligar, escolher qual câmera usar e a qualidade (360p a 1080p), com miniaturas de todos que estão com a câmera ligada
- Microfone com mudo/desmudo, indicador visual de quem está falando
- **Configurações completas de voz e vídeo** (ícone ⚙️ na barra inferior):
  - Escolher dispositivo de entrada (microfone), câmera e saída de áudio (alto-falante/fone), com suporte a `setSinkId` onde o navegador permitir
  - Volume do microfone ajustável (0–200%)
  - Cancelamento de eco, supressão de ruído e controle automático de ganho, cada um ligável/desligável
  - **Isolamento de voz**: filtro de frequências fora da faixa da voz humana + compressão dinâmica, para atenuar ruído de fundo constante (ventilador, teclado, etc.) — processado no navegador, sem enviar áudio para nenhum servidor
  - **Testar microfone**: ouça sua própria voz em tempo real (com o mesmo processamento que os outros participantes recebem) para confirmar que está tudo funcionando
  - Volume por participante (0–200%), ajustável individualmente
  - Volume do compartilhamento de tela, independente do volume dos participantes
- **Desativar áudio (deafen)**: um botão para não ouvir mais ninguém na sala (e muta o microfone junto, como no Discord)
- Chat em tempo real com nome e horário
- Lista de participantes com status (microfone, compartilhando tela)
- Host da sala: pode remover participantes e encerrar a sala; se o host sair, outro participante assume automaticamente
- Reconexão automática em caso de instabilidade de rede
- Nome salvo localmente no navegador (sem cadastro)
- Interface responsiva (desktop e mobile), tema escuro, glassmorphism
- Limite de participantes configurável (padrão: 10 por sala)

## 🧱 Tecnologias

- HTML5 + CSS3 (sem framework, sem build)
- JavaScript puro (ES2020+, classes, `EventTarget`)
- [PeerJS](https://peerjs.com) sobre WebRTC (áudio/vídeo P2P + canal de dados para chat e controle)
- STUN público do Google para atravessar NAT
- Hospedagem 100% estática (GitHub Pages, Netlify, Cloudflare Pages, etc. — qualquer um funciona)

## 📁 Estrutura do projeto

```text
screenroom/
├── index.html          # landing page (criar/entrar em sala)
├── room.html            # interface da sala
├── css/
│   └── style.css         # todo o visual do app
├── js/
│   ├── config.js          # configurações centralizadas (limite de sala, qualidade, ICE servers)
│   ├── utils.js            # funções auxiliares (código de sala, nome salvo, etc.)
│   ├── landing.js           # lógica da página inicial
│   ├── mesh.js               # rede P2P (PeerJS): signaling, malha completa, chat, mídia
│   └── room.js                # interface da sala (liga o mesh.js à tela)
├── .nojekyll             # evita que o GitHub Pages tente processar o site com Jekyll
├── .gitignore
├── LICENSE
└── README.md
```

Não existe `package.json` nem passo de build: os arquivos são servidos exatamente como estão.

---

## 🚀 COMO HOSPEDAR — passo a passo (GitHub Pages)

Não presuma nenhum conhecimento técnico prévio. Siga na ordem.

### Passo 1 — Extraia o ZIP

Baixe `screenroom.zip` e extraia em uma pasta no seu computador. Você deve ver os arquivos `index.html`, `room.html`, as pastas `css/` e `js/`, etc., soltos dentro da pasta (não dentro de mais uma subpasta).

### Passo 2 — Crie uma conta no GitHub (se ainda não tiver)

1. Acesse [github.com](https://github.com) e clique em **Sign up**.
2. Siga os passos (e-mail, senha, confirmação).

### Passo 3 — Crie um novo repositório

1. No canto superior direito do GitHub, clique no **+** e depois em **New repository**.
2. Em **Repository name**, digite `screenroom` (pode ser outro nome, se preferir).
3. Deixe marcado como **Public**.
4. **Não marque** "Add a README file" (o ZIP já traz um).
5. Clique em **Create repository**.

### Passo 4 — Envie os arquivos (upload direto, sem terminal)

1. Na página do repositório recém-criado, clique no link **uploading an existing file** (ou vá em **Add file → Upload files**).
2. Arraste **todos os arquivos e pastas** extraídos do ZIP para a área de upload (incluindo `index.html`, `room.html`, a pasta `css`, a pasta `js`, o `README.md`, o `.gitignore` e o `.nojekyll`).
   - Dica: arraste a pasta inteira do projeto de uma vez — o GitHub mantém a estrutura de pastas automaticamente.
   - O arquivo `.nojekyll` é invisível em alguns exploradores de arquivo por começar com ponto — ative "mostrar arquivos ocultos" no seu sistema para garantir que ele foi incluído. Se ele não aparecer, sem problemas: você também pode criá-lo depois clicando em **Add file → Create new file** no GitHub e nomeando o arquivo `.nojekyll` (deixe o conteúdo vazio).
3. Role até o fim da página, escreva uma mensagem como `Primeira versão do ScreenRoom` no campo de commit.
4. Clique em **Commit changes**.

### Passo 5 — Ative o GitHub Pages

1. No repositório, clique em **Settings** (aba no topo).
2. No menu lateral esquerdo, clique em **Pages**.
3. Em **Build and deployment → Source**, selecione **Deploy from a branch**.
4. Em **Branch**, selecione `main` (ou `master`, dependendo do nome padrão) e a pasta `/ (root)`.
5. Clique em **Save**.
6. Aguarde de 1 a 3 minutos. Atualize a página — vai aparecer uma faixa verde com o link do seu site, algo como:
   `https://SEU-USUARIO.github.io/screenroom/`

### Passo 6 — Abra o link e teste

1. Abra o link em duas abas (ou em dois dispositivos diferentes).
2. Na primeira, clique em **Criar sala**, digite um nome e anote o código gerado.
3. Na segunda, clique em **Entrar em sala**, digite o código e entre.
4. Clique em **Compartilhar tela** na sala criada — a outra aba/dispositivo deve ver a tela em poucos segundos.
5. Teste o chat, o microfone e o botão de qualidade.

**Pronto — é só isso.** Não há passo 7, não há backend para configurar, não há variável de ambiente.

---

## 🔒 HTTPS

O GitHub Pages já serve seu site em **HTTPS automaticamente** (o link começa com `https://`). Isso é obrigatório: navegadores só liberam `getDisplayMedia` (compartilhar tela) e o microfone em páginas HTTPS (ou em `localhost`, durante testes locais). Você não precisa configurar nada — já vem pronto.

---

## 🧪 Testando localmente antes de publicar (opcional)

Você não precisa disso para publicar, mas se quiser testar no seu computador antes:

- **Opção simples**: abra o `index.html` direto no navegador — funciona para ver o visual, mas o microfone/compartilhamento de tela pode ser bloqueado em alguns navegadores por não ser `https://` nem `localhost`.
- **Opção recomendada**: com [Node.js](https://nodejs.org) instalado, rode dentro da pasta do projeto:
  ```bash
  npx serve .
  ```
  e abra o endereço `http://localhost:3000` mostrado no terminal (`localhost` é tratado como seguro pelo navegador, então o microfone e a tela funcionam normalmente).

---

## ⚙️ Configurações que você pode alterar

Tudo fica centralizado em `js/config.js`, comentado:

- `MAX_PARTICIPANTS` — limite de pessoas por sala (padrão: 10).
- `ROOM_CODE_LENGTH` / `ROOM_CODE_CHARS` — formato do código da sala.
- `ICE_SERVERS` — servidores STUN/TURN usados para conectar os navegadores.
- `QUALITY_PRESETS` — as opções do menu de qualidade da tela e o bitrate máximo de cada uma.
- `CAMERA_PRESETS` — as opções de qualidade da webcam.
- `DEFAULT_AUDIO_SETTINGS` — valores padrão de cancelamento de eco, supressão de ruído, controle automático de ganho e isolamento de voz.

Não é necessário rebuild nem terminal: edite o arquivo, faça upload da versão nova no GitHub (substituindo o arquivo) e o GitHub Pages atualiza sozinho em 1–2 minutos.

---

## 📡 TURN opcional (para redes mais restritivas)

Na grande maioria dos casos (redes domésticas, 4G/5G, a maior parte das redes de trabalho), os servidores **STUN** públicos já incluídos são suficientes para conectar dois navegadores diretamente. Em alguns casos raros — ambas as pessoas atrás de firewalls corporativos bem restritivos, por exemplo — pode ser necessário um servidor **TURN**, que retransmite a mídia quando a conexão direta não é possível.

Não existe TURN público, gratuito e confiável (retransmitir vídeo tem custo real de banda), então isso exige um provedor. Se algum dia precisar:

1. Crie uma conta gratuita em um provedor como [Metered.ca](https://www.metered.ca/tools/openrelay/) (tem um plano gratuito com cota mensal) ou [Twilio](https://www.twilio.com/stun-turn) (STUN/TURN pago, com um período de teste).
2. Copie as credenciais TURN fornecidas (URL, usuário e senha).
3. Abra `js/config.js` e adicione ao array `ICE_SERVERS`:
   ```js
   { urls: "turn:seu-host-turn:3478", username: "SEU_USUARIO", credential: "SUA_SENHA" }
   ```
4. Suba a alteração no GitHub — pronto, sem reiniciar nada.

Isso é **opcional** e a maioria dos usuários nunca vai precisar disso.

---

## 🔁 Rodando seu próprio signaling (opcional, avançado)

O projeto usa a nuvem pública gratuita do PeerJS por padrão (não exige nenhuma configuração sua). Se um dia você quiser depender só de você mesmo (por exemplo, para uso intensivo em produção), é possível rodar seu próprio `PeerServer` — mas isso já exige um servidor Node.js (Render, Railway, Fly.io etc.), o que contraria o objetivo deste projeto de "publicar só com GitHub Pages". Se chegar a esse ponto, veja a documentação oficial: [github.com/peers/peerjs-server](https://github.com/peers/peerjs-server). Para o uso normal do ScreenRoom, isso **não é necessário**.

---

## 🧯 Se der erro, faça isso

**"Sala não encontrada"**
- Confira se o código tem exatamente 5 caracteres e foi digitado certo (o app ignora maiúsculas/minúsculas).
- A pessoa que criou a sala precisa continuar com a aba aberta até alguém entrar — a sala existe enquanto pelo menos uma pessoa estiver conectada nela.
- Espere alguns segundos: a primeira conexão ao serviço de signaling pode demorar um pouco.

**Tela não compartilha / botão não faz nada**
- Confirme que você clicou em "Permitir" no seletor nativo do navegador.
- Use Chrome, Edge ou Firefox atualizados — Safari tem suporte parcial a `getDisplayMedia`.
- Verifique se o site está em `https://` (o GitHub Pages já garante isso).

**Microfone não funciona**
- Verifique se o navegador não bloqueou a permissão (ícone de cadeado na barra de endereço → Permissões do site).
- Em alguns sistemas, é preciso liberar o microfone para o navegador nas configurações do próprio sistema operacional.

**Áudio do sistema não transmite junto com a tela**
- Isso depende do navegador e do sistema operacional: no Chrome/Edge, ao compartilhar, marque a opção "Compartilhar áudio da guia/tela" na janela de seleção. No Firefox e no macOS (em compartilhamento de tela inteira), essa opção pode não estar disponível — é uma limitação do próprio navegador/SO, não do ScreenRoom.

**"Reconectando..." não sai da tela**
- Verifique sua conexão com a internet.
- Atualize a página — a sala continua existindo enquanto outros participantes estiverem conectados.

**Conexão não fecha entre dois participantes específicos**
- Provavelmente é um caso que precisa de TURN (veja a seção acima) — geralmente acontece quando os dois lados estão em redes corporativas com firewall restritivo.

**Página em branco / erro no console**
- Confirme que a pasta `js/` e `css/` foram enviadas completas para o GitHub (todos os arquivos).
- Confirme que o GitHub Pages está apontando para a branch e pasta certas (Settings → Pages).

**O site abriu, mas veio sem estilo (sem visual)**
- Normalmente é o `.nojekyll` faltando ou a pasta `css/` não foi enviada — reenvie os arquivos garantindo que a estrutura de pastas foi preservada.

---

## 🚧 Limitações conhecidas

- Depende da disponibilidade do serviço público de signaling do PeerJS (gratuito, mantido pela comunidade, sem SLA garantido).
- Sem servidor TURN próprio configurado por padrão: em redes muito restritivas, a conexão P2P pode falhar (veja a seção de TURN).
- A arquitetura é *full-mesh* (cada participante se conecta diretamente a todos os outros): ótimo até ~10 pessoas, mas se várias pessoas compartilharem tela ao mesmo tempo, o consumo de upload de quem está compartilhando aumenta proporcionalmente ao número de espectadores.
- Não há persistência: se todos saírem da sala, ela deixa de existir (não há histórico de chat salvo em nenhum servidor).
- Remoção de participante pelo host é aplicada a nível de aplicação (fecha a conexão); não é uma trava de segurança de nível bancário — é o mesmo padrão de outras ferramentas simples P2P.

## 📄 Licença

Este projeto é distribuído sob a licença MIT — veja o arquivo `LICENSE`.
