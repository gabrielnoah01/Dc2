import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC, IPC_EVENT, OnlyApi } from '../shared/ipc';

/** Assina um canal e devolve a função de cancelamento — evita listeners órfãos
 *  quando componentes React desmontam. */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: OnlyApi = {
  createServer: (options) => ipcRenderer.invoke(IPC.createServer, options),
  joinServer: (options) => ipcRenderer.invoke(IPC.joinServer, options),
  leave: () => ipcRenderer.invoke(IPC.leave),
  reconnectNow: () => ipcRenderer.invoke(IPC.reconnectNow),
  cancelReconnect: () => ipcRenderer.invoke(IPC.cancelReconnect),
  getLastSession: () => ipcRenderer.invoke(IPC.getLastSession),
  forgetLastSession: () => ipcRenderer.invoke(IPC.forgetLastSession),
  sendChat: (payload) => ipcRenderer.invoke(IPC.sendChat, payload),
  requestAttachment: (messageId) => ipcRenderer.invoke(IPC.requestAttachment, messageId),
  listConversations: () => ipcRenderer.invoke(IPC.listConversations),
  deleteConversation: (id) => ipcRenderer.invoke(IPC.deleteConversation, id),
  clearConversation: (id) => ipcRenderer.invoke(IPC.clearConversation, id),
  sendSignal: (payload) => ipcRenderer.invoke(IPC.sendSignal, payload),
  setScreenShare: (active) => ipcRenderer.invoke(IPC.setScreenShare, active),
  getScreenSources: () => ipcRenderer.invoke(IPC.getScreenSources),
  selectScreenSource: (sourceId) => ipcRenderer.invoke(IPC.selectScreenSource, sourceId),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  resetSettings: () => ipcRenderer.invoke(IPC.resetSettings),
  testShortcut: (accelerator) => ipcRenderer.invoke(IPC.testShortcut, accelerator),
  decideJoin: (id, accept) => ipcRenderer.invoke(IPC.decideJoin, id, accept),
  listJoinRequests: () => ipcRenderer.invoke(IPC.listJoinRequests),

  onParticipants: (handler) => subscribe(IPC_EVENT.participants, handler),
  onChat: (handler) => subscribe(IPC_EVENT.chat, handler),
  onHistory: (handler) => subscribe(IPC_EVENT.history, handler),
  onAttachment: (handler) => subscribe(IPC_EVENT.attachment, handler),
  onSignal: (handler) => subscribe(IPC_EVENT.signal, handler),
  onScreenShare: (handler) => subscribe(IPC_EVENT.screenShare, handler),
  onDisconnected: (handler) => subscribe(IPC_EVENT.disconnected, handler),
  onReconnect: (handler) => subscribe(IPC_EVENT.reconnect, handler),
  onError: (handler) => subscribe(IPC_EVENT.error, handler),
  onUpdate: (handler) => subscribe(IPC_EVENT.update, handler),
  onJoinRequests: (handler) => subscribe(IPC_EVENT.joinRequests, handler),
  onJoinPending: (handler) => subscribe(IPC_EVENT.joinPending, handler),
  onSettings: (handler) => subscribe(IPC_EVENT.settings, handler),
  onShortcut: (handler) => subscribe(IPC_EVENT.shortcut, handler),
  onConnection: (handler) => subscribe(IPC_EVENT.connection, handler),
};

contextBridge.exposeInMainWorld('only', api);
