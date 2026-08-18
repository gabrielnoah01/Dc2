# Only

Chat de texto, voz e compartilhamento de tela **sem servidor central**. Uma pessoa abre o
servidor no próprio PC (o "host"), copia o link e quem quiser conversar cola o link e se
conecta direto naquela máquina — uma rede privada entre amigos.

## Como funciona

- O host sobe um **servidor WebSocket** (`ws`) em `0.0.0.0:PORTA`. Cada convidado abre **uma**
  conexão WebSocket direto para o host — topologia estrela, sem mesh entre convidados.
- Esse canal WebSocket carrega: chat de texto (o host faz o broadcast), presença e a
  **sinalização WebRTC** (SDP/ICE) repassada pelo host.
- Voz e tela rodam em `RTCPeerConnection` host↔convidado. O host recebe o áudio de cada um e
  **repassa** (forwarding) as tracks para os demais na conexão já existente. Sem mixagem.
- Não há servidor de sinalização permanente: quando o host fecha o app, o "servidor" some.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Abre Vite (`localhost:5173`), compila o processo main em watch e sobe o Electron.
Para testar host + convidado na mesma máquina, abra **duas instâncias** (o app não bloqueia
segunda instância em dev) e use `127.0.0.1:51820#TOKEN` no convidado.

## Build do executável (Windows)

```bash
npm run dist
```

Isso faz, em ordem: gera o ícone (`npm run icon` → `build/icon.ico`), compila main +
renderer e empacota com `electron-builder`. Saída em `release/`:

- `Only-0.1.0-setup.exe` — instalador NSIS (permite escolher a pasta, cria atalho,
  desinstala pelo painel de controle).
- `Only-0.1.0-portable.exe` — **executável único**, roda sem instalar. É o jeito mais
  fácil de mandar para um amigo.

O ícone é gerado por código (`scripts/make-icon.mjs`), sem ferramenta externa. Para trocar,
sobrescreva `build/icon.ico` com seu próprio arquivo (256x256 incluído).

Só quer o portátil ou só o instalador:

```bash
npx electron-builder --win portable
npx electron-builder --win nsis
```

Para testar o empacotamento sem gerar instalador (gera a pasta descompactada):

```bash
npm run dist:dir
```

> O `.exe` não é assinado, então o Windows SmartScreen mostra "Editor desconhecido" na
> primeira execução — clique em "Mais informações" → "Executar assim mesmo". Avise seus
> amigos disso.

## Link de convite

Formato curto (o que aparece na UI para copiar):

```
203.0.113.5:51820#Xk29Ab3F
```

Formato URI (para quando o protocolo `only://` estiver registrado no Windows):

```
only://join?host=<ip>&port=<port>&token=<token>
```

O token é regerado toda vez que o servidor sobe. Token errado = conexão fechada na hora,
com rate limit de 5 tentativas por IP por minuto.

## Rede

- Ao criar o servidor o app tenta abrir a porta automaticamente via **UPnP/NAT-PMP**.
  Se falhar, a UI mostra "abra a porta X (TCP) no roteador".
- O IP público é descoberto via `api.ipify.org` (única chamada externa; serve só para montar
  o link, não é sinalização).
- Para amigos na mesma rede Wi-Fi existe sempre um link de IP local, que funciona sem
  qualquer configuração de roteador.
- Se a operadora do host usar **CGNAT**, port-forward e UPnP não resolvem — nesse caso só
  LAN ou um túnel externo.

## Estrutura

```
src/
  main/            # processo Node: servidor ws, cliente ws, UPnP, IPC
    network/       # hostServer.ts, guestClient.ts, upnp.ts, publicIp.ts
    ipc/           # handlers.ts (ponte main <-> renderer)
  preload/         # contextBridge -> window.only
  renderer/        # React + Vite + Tailwind
    webrtc/        # peerLink.ts, voiceManager.ts, screenShareManager.ts
    screens/       # HomeScreen (criar/entrar), ServerScreen (sala)
  shared/          # protocol.ts (mensagens ws), ipc.ts, inviteLink.ts, constants.ts
```

Regra de divisão: `ws` só existe no processo main; `RTCPeerConnection`, `getUserMedia` e
`getDisplayMedia` só existem no renderer. A sinalização atravessa por IPC.

## Limitações conhecidas

- O chat de texto trafega **sem criptografia** (`ws://`, sem TLS). Voz e tela já são
  criptografadas por DTLS-SRTP.
- Sem identidade real: o nome é escolhido livremente por quem entra.
- Áudio com forwarding começa a degradar acima de ~5 participantes.
- Um compartilhamento de tela por vez.
