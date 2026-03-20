import { ElectronAPI } from '@electron-toolkit/preload'

interface AuthState {
  loggedIn: boolean
  models: Array<{ id: string; name: string }>
  defaultModelId: string
}

type AgentStreamEvent =
  | { type: 'start'; chatId: string; requestId: string }
  | { type: 'delta'; chatId: string; requestId: string; delta: string }
  | { type: 'end'; chatId: string; requestId: string }
  | { type: 'error'; chatId: string; requestId: string; error: string }

interface PiDesktopApi {
  getAuthState: () => Promise<AuthState>
  loginCodex: () => Promise<{ ok: true; state: AuthState } | { ok: false; error: string }>
  openFolder: () => Promise<{ path: string; name: string } | null>
  sendChatMessage: (payload: {
    chatId: string
    cwd: string
    prompt: string
    modelId: string
  }) => Promise<{ ok: true; requestId: string } | { ok: false; error: string }>
  onAgentStreamEvent: (listener: (event: AgentStreamEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PiDesktopApi
  }
}
