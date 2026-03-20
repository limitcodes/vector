import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type AuthState = {
  loggedIn: boolean
  models: Array<{ id: string; name: string }>
  defaultModelId: string
}

type AgentStreamEvent =
  | { type: 'start'; chatId: string; requestId: string }
  | { type: 'delta'; chatId: string; requestId: string; delta: string }
  | { type: 'end'; chatId: string; requestId: string }
  | { type: 'error'; chatId: string; requestId: string; error: string }

const api = {
  getAuthState: async (): Promise<AuthState> => {
    return ipcRenderer.invoke('auth:get-state')
  },
  loginCodex: async (): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('auth:login-codex')
  },
  openFolder: async (): Promise<{ path: string; name: string } | null> => {
    return ipcRenderer.invoke('dialog:open-folder')
  },
  sendChatMessage: async (payload: {
    chatId: string
    cwd: string
    prompt: string
    modelId: string
  }): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('agent:send-message', payload) as Promise<
      { ok: true; requestId: string } | { ok: false; error: string }
    >
  },
  onAgentStreamEvent: (listener: (event: AgentStreamEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent): void =>
      listener(payload)
    ipcRenderer.on('agent:stream-event', wrapped)
    return () => {
      ipcRenderer.removeListener('agent:stream-event', wrapped)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
