import { ElectronAPI } from '@electron-toolkit/preload'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

interface AuthState {
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

type QuestionPromptQuestion = {
  index: number
  question: string
  topic: string
  options: string[]
}

type QuestionPromptEvent = {
  chatId: string
  toolCallId: string
  questions: QuestionPromptQuestion[]
}

type QuestionAnswer = {
  topic: string
  question: string
  answer: string
}

interface TerminalSessionSummary {
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

type ReviewFile = {
  path: string
  oldText: string
  newText: string
  added: number
  removed: number
}

interface PiDesktopApi {
  getAuthState: () => Promise<AuthState>
  loginCodex: () => Promise<{ ok: true; state: AuthState } | { ok: false; error: string }>
  logoutCodex: () => Promise<{ ok: true; state: AuthState } | { ok: false; error: string }>
  openFolder: () => Promise<{ path: string; name: string } | null>
  getWorkspaceDiff: (payload: {
    cwd: string
  }) => Promise<{ ok: true; files: ReviewFile[] } | { ok: false; error: string }>
  sendChatMessage: (payload: {
    chatId: string
    cwd: string
    prompt: string
    modelId: string
    thinkingLevel: ThinkingLevel
  }) => Promise<{ ok: true; requestId: string } | { ok: false; error: string }>
  showChatNotification: (payload: {
    chatId: string
    title: string
    body: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  submitQuestionResponse: (payload: {
    toolCallId: string
    cancelled?: boolean
    answers?: QuestionAnswer[]
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  onAgentStreamEvent: (listener: (event: AgentStreamEvent) => void) => () => void
  onChatNotificationClick: (listener: (event: ChatNotificationClickEvent) => void) => () => void
  onQuestionPrompt: (listener: (event: QuestionPromptEvent) => void) => () => void
  listTerminals: () => Promise<TerminalSessionSummary[]>
  createTerminal: (payload: {
    cwd?: string
    title?: string
  }) => Promise<{ ok: true; terminal: TerminalSessionSummary } | { ok: false; error: string }>
  writeTerminal: (payload: {
    terminalId: string
    data: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  resizeTerminal: (payload: {
    terminalId: string
    cols: number
    rows: number
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  closeTerminal: (payload: { terminalId: string }) => Promise<{ ok: true } | { ok: false; error: string }>
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PiDesktopApi
  }
}
