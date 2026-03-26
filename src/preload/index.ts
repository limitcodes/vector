import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

type AuthState = {
  loggedIn: boolean
  models: Array<{ id: string; name: string }>
  defaultModelId: string
}

type AgentStreamEvent =
  | { type: 'start'; chatId: string; requestId: string }
  | { type: 'text_delta'; chatId: string; requestId: string; delta: string }
  | { type: 'thinking_delta'; chatId: string; requestId: string; delta: string }
  | {
      type: 'tool_start'
      chatId: string
      requestId: string
      toolCallId: string
      toolName: string
      argsText: string
    }
  | {
      type: 'tool_update'
      chatId: string
      requestId: string
      toolCallId: string
      toolName: string
      output: string
    }
  | {
      type: 'tool_end'
      chatId: string
      requestId: string
      toolCallId: string
      toolName: string
      output: string
      isError: boolean
    }
  | { type: 'end'; chatId: string; requestId: string }
  | { type: 'error'; chatId: string; requestId: string; error: string }

type ChatNotificationClickEvent = {
  chatId: string
}

type TerminalSessionSummary = {
  id: string
  title: string
  cwd: string
  shell: string
  pid: number
  status: 'running' | 'exited'
  exitCode: number | null
}

type TerminalEvent =
  | { type: 'output'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number | null }

const api = {
  getAuthState: async (): Promise<AuthState> => {
    return ipcRenderer.invoke('auth:get-state')
  },
  loginCodex: async (): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('auth:login-codex')
  },
  logoutCodex: async (): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('auth:logout-codex')
  },
  openFolder: async (): Promise<{ path: string; name: string } | null> => {
    return ipcRenderer.invoke('dialog:open-folder')
  },
  sendChatMessage: async (payload: {
    chatId: string
    cwd: string
    prompt: string
    modelId: string
    thinkingLevel: ThinkingLevel
  }): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('agent:send-message', payload) as Promise<
      { ok: true; requestId: string } | { ok: false; error: string }
    >
  },
  showChatNotification: async (payload: {
    chatId: string
    title: string
    body: string
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('chat:show-notification', payload)
  },
  onAgentStreamEvent: (listener: (event: AgentStreamEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent): void =>
      listener(payload)
    ipcRenderer.on('agent:stream-event', wrapped)
    return () => {
      ipcRenderer.removeListener('agent:stream-event', wrapped)
    }
  },
  onChatNotificationClick: (
    listener: (event: ChatNotificationClickEvent) => void
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ChatNotificationClickEvent): void =>
      listener(payload)
    ipcRenderer.on('chat-notification:click', wrapped)
    return () => {
      ipcRenderer.removeListener('chat-notification:click', wrapped)
    }
  },
  listTerminals: async (): Promise<TerminalSessionSummary[]> => {
    return ipcRenderer.invoke('terminal:list')
  },
  createTerminal: async (payload: {
    cwd?: string
    title?: string
  }): Promise<{ ok: true; terminal: TerminalSessionSummary } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('terminal:create', payload)
  },
  writeTerminal: async (payload: {
    terminalId: string
    data: string
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('terminal:write', payload)
  },
  resizeTerminal: async (payload: {
    terminalId: string
    cols: number
    rows: number
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('terminal:resize', payload)
  },
  closeTerminal: async (payload: {
    terminalId: string
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    return ipcRenderer.invoke('terminal:close', payload)
  },
  onTerminalEvent: (listener: (event: TerminalEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalEvent): void =>
      listener(payload)
    ipcRenderer.on('terminal:event', wrapped)
    return () => {
      ipcRenderer.removeListener('terminal:event', wrapped)
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
