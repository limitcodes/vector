import { html, type TemplateResult } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { repeat } from 'lit/directives/repeat.js'
import { type DirectiveResult } from 'lit/directive.js'
import * as DiffLib from 'diff'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'

// Custom directive to scroll to bottom of element
const scrollToBottom = (): DirectiveResult => {
  return ref((element?: Element | null) => {
    if (element) {
      queueMicrotask(() => {
        element.scrollTop = element.scrollHeight
      })
    }
  })
}
import { icon } from '@mariozechner/mini-lit/dist/icons.js'
import { Select } from '@mariozechner/mini-lit/dist/Select.js'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from '@mariozechner/mini-lit/dist/Dialog.js'
import { Button } from '@mariozechner/mini-lit/dist/Button.js'
import {
  AlertTriangle,
  Diff,
  Folder,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  SquarePen,
  TerminalSquare,
  Trash2,
  X
} from 'lucide'

type Role = 'user' | 'assistant'

type ModelOption = {
  id: string
  name: string
  thinkingLevels: ThinkingLevel[]
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

type PromptImageAttachment = {
  type: 'image'
  mimeType: string
  data: string
  name?: string
}

type ComposerImage = {
  id: string
  name: string
  mimeType: string
  data: string
  previewUrl: string
}

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh'
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

interface ReviewFile {
  path: string
  oldText: string
  newText: string
  added: number
  removed: number
}

interface ReviewDiffRow {
  kind: 'context' | 'add' | 'remove' | 'ellipsis'
  text: string
  leftLineNumber: number | null
  rightLineNumber: number | null
}

interface ToolInvocation {
  id: string
  name: string
  argsText: string
  output: string
  status: 'running' | 'done' | 'error'
}

interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  streaming?: boolean
  thinking?: string
  tools?: ToolInvocation[]
}

interface Workspace {
  path: string
  name: string
  createdAt: number
}

interface Chat {
  id: string
  workspacePath: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

interface PersistedState {
  workspaces: Workspace[]
  chats: Chat[]
  activeWorkspacePath: string
  activeChatId: string
  selectedModelId: string
  selectedThinkingLevel: ThinkingLevel
}

interface ChatRunState {
  status: 'running' | 'completed' | 'error'
  requestId: string | null
  assistantMessageId: string | null
  hasUnreadCompletion: boolean
}

interface AppState extends PersistedState {
  composer: string
  composerImages: ComposerImage[]
  chatRunStateByChatId: Record<string, ChatRunState>
  authChecked: boolean
  loggedIn: boolean
  models: ModelOption[]
  sidebarCollapsed: boolean
  expandedWorkspaces: Set<string>
  settingsDialogOpen: boolean
  deleteChatId: string | null
  terminalDockOpen: boolean
  terminalHeight: number
  terminalSessions: TerminalSessionSummary[]
  activeTerminalId: string
  reviewSidebarOpen: boolean
  reviewFiles: ReviewFile[]
  expandedReviewFiles: Set<string>
  reviewLoading: boolean
  reviewError: string | null
  reviewLastLoadedWorkspacePath: string
}

const STORAGE_KEY = 'vector.chats.v5'
const LEGACY_STORAGE_KEYS = ['pi-ui.chats.v5']
const DEFAULT_WORKSPACE_PATH = '__no-folder__'
const REVIEW_SIDEBAR_WIDTH = 720
const REVIEW_REFRESH_DEBOUNCE_MS = 180
const REVIEW_DIFF_CONTEXT_LINES = 3
const DEFAULT_TERMINAL_HEIGHT = 340
const MIN_TERMINAL_HEIGHT = 160
const MAX_TERMINAL_HEIGHT = 800

const now = (): number => Date.now()

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const createWelcomeMessage = (): Message => ({
  id: createId(),
  role: 'assistant',
  content: '',
  createdAt: now()
})

const createChat = (workspace: Workspace, title = 'New chat'): Chat => {
  const timestamp = now()
  return {
    id: createId(),
    workspacePath: workspace.path,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [createWelcomeMessage()]
  }
}

const fallbackWorkspace: Workspace = {
  path: DEFAULT_WORKSPACE_PATH,
  name: 'No folder selected',
  createdAt: now()
}

const formatRelativeTime = (value: number): string => {
  const elapsed = Math.max(0, now() - value)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (elapsed >= day) return `${Math.max(1, Math.round(elapsed / day))}d`
  if (elapsed >= hour) return `${Math.max(1, Math.round(elapsed / hour))}h`
  if (elapsed >= minute) return `${Math.max(1, Math.round(elapsed / minute))}m`
  return 'now'
}

const getChatTitleFromInput = (content: string): string => {
  const clean = content.trim().replace(/\s+/g, ' ')
  if (!clean) return 'New chat'
  return clean.slice(0, 40)
}

const sortChats = (chats: Chat[]): Chat[] => [...chats].sort((a, b) => b.updatedAt - a.updatedAt)

const getWorkspaceByPath = (workspaces: Workspace[], path: string): Workspace => {
  return workspaces.find((workspace) => workspace.path === path) ?? fallbackWorkspace
}

const getChatsForWorkspace = (workspacePath: string, chats: Chat[]): Chat[] => {
  return sortChats(chats.filter((chat) => chat.workspacePath === workspacePath))
}

const loadState = (): AppState => {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value) => Boolean(value))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
      const chats = Array.isArray(parsed.chats)
        ? sortChats(
            parsed.chats.map((chat) => ({
              ...chat,
              messages: Array.isArray(chat.messages)
                ? chat.messages.map((message) => ({
                    ...message,
                    thinking: typeof message.thinking === 'string' ? message.thinking : '',
                    tools: Array.isArray(message.tools)
                      ? message.tools.map((tool) => ({
                          id: String(tool.id ?? createId()),
                          name: typeof tool.name === 'string' ? tool.name : 'tool',
                          argsText: typeof tool.argsText === 'string' ? tool.argsText : '',
                          output: typeof tool.output === 'string' ? tool.output : '',
                          status:
                            tool.status === 'done' || tool.status === 'error'
                              ? tool.status
                              : 'running'
                        }))
                      : []
                  }))
                : []
            }))
          )
        : []
      const activeWorkspacePath =
        parsed.activeWorkspacePath &&
        workspaces.some((workspace) => workspace.path === parsed.activeWorkspacePath)
          ? parsed.activeWorkspacePath
          : (workspaces[0]?.path ?? DEFAULT_WORKSPACE_PATH)
      const workspaceChats = getChatsForWorkspace(activeWorkspacePath, chats)
      const activeChatId =
        parsed.activeChatId && workspaceChats.some((chat) => chat.id === parsed.activeChatId)
          ? parsed.activeChatId
          : (workspaceChats[0]?.id ?? '')

      return {
        workspaces,
        chats,
        activeWorkspacePath,
        activeChatId,
        selectedModelId: parsed.selectedModelId ?? '',
        selectedThinkingLevel: parsed.selectedThinkingLevel ?? 'medium',
        composer: '',
        composerImages: [],
        chatRunStateByChatId: {},
        authChecked: false,
        loggedIn: false,
        models: [],
        sidebarCollapsed: true,
        expandedWorkspaces: new Set<string>(),
        settingsDialogOpen: false,
        deleteChatId: null,
        terminalDockOpen: false,
        terminalHeight: DEFAULT_TERMINAL_HEIGHT,
        terminalSessions: [],
        activeTerminalId: '',
        reviewSidebarOpen: false,
        reviewFiles: [],
        expandedReviewFiles: new Set<string>(),
        reviewLoading: false,
        reviewError: null,
        reviewLastLoadedWorkspacePath: ''
      }
    }
  } catch (error) {
    console.error('Failed to load chats', error)
  }

  return {
    workspaces: [],
    chats: [],
    activeWorkspacePath: DEFAULT_WORKSPACE_PATH,
    activeChatId: '',
    selectedModelId: '',
    selectedThinkingLevel: 'medium',
    composer: '',
    composerImages: [],
    chatRunStateByChatId: {},
    authChecked: false,
    loggedIn: false,
    models: [],
    sidebarCollapsed: true,
    expandedWorkspaces: new Set<string>(),
    settingsDialogOpen: false,
    deleteChatId: null,
    terminalDockOpen: false,
    terminalHeight: DEFAULT_TERMINAL_HEIGHT,
    terminalSessions: [],
    activeTerminalId: '',
    reviewSidebarOpen: false,
    reviewFiles: [],
    expandedReviewFiles: new Set<string>(),
    reviewLoading: false,
    reviewError: null,
    reviewLastLoadedWorkspacePath: ''
  }
}

let state = loadState()
let notifyChange: (() => void) | undefined
let folderPickerInFlight = false
let unsubscribeStream: (() => void) | undefined
let unsubscribeTerminal: (() => void) | undefined
let unsubscribeChatNotificationClick: (() => void) | undefined
let composerTextarea: HTMLTextAreaElement | null = null
let composerFileInput: HTMLInputElement | null = null
let chatScrollContainer: HTMLDivElement | null = null
const terminalInstances = new Map<string, { terminal: XTerm; fitAddon: FitAddon }>()
const terminalMounts = new Map<string, HTMLDivElement>()
const pendingTerminalOutput = new Map<string, string[]>()
let terminalResizeTick: number | null = null
let reviewRefreshTick: number | null = null
let reviewRefreshRequestId = 0

const syncComposerHeight = (): void => {
  if (!composerTextarea) return

  const minHeight = 40
  const maxHeight = 168
  composerTextarea.style.height = '0px'
  const nextHeight = Math.min(Math.max(composerTextarea.scrollHeight, minHeight), maxHeight)
  composerTextarea.style.height = `${nextHeight}px`
  composerTextarea.style.overflowY = composerTextarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

const focusComposer = (): void => {
  queueMicrotask(() => {
    composerTextarea?.focus()
  })
}

const revokeComposerImagePreviews = (images: ComposerImage[]): void => {
  for (const image of images) {
    URL.revokeObjectURL(image.previewUrl)
  }
}

const readFileAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Failed to read ${file.name}`))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

const createComposerImageFromFile = async (file: File): Promise<ComposerImage | null> => {
  if (!file.type || !file.type.startsWith('image/')) {
    return null
  }

  const dataUrl = await readFileAsDataUrl(file)
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/)
  if (!match) {
    throw new Error(`Unsupported image format for ${file.name}`)
  }

  return {
    id: createId(),
    name: file.name,
    mimeType: match[1],
    data: match[2],
    previewUrl: URL.createObjectURL(file)
  }
}

const scrollActiveChatToBottom = (): void => {
  queueMicrotask(() => {
    if (!chatScrollContainer) return
    chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight
  })
}

const getChatRunState = (current: AppState, chatId: string): ChatRunState | undefined => {
  return current.chatRunStateByChatId[chatId]
}

const getDefaultThinkingLevel = (levels: ThinkingLevel[]): ThinkingLevel => {
  if (levels.includes('medium')) return 'medium'
  return levels[0] ?? 'off'
}

const getSelectedModel = (current: AppState = state): ModelOption | undefined => {
  return current.models.find((model) => model.id === current.selectedModelId)
}

const getAvailableThinkingLevels = (current: AppState = state): ThinkingLevel[] => {
  return getSelectedModel(current)?.thinkingLevels ?? ['off']
}

const isChatRunning = (chatId: string, current: AppState = state): boolean => {
  return getChatRunState(current, chatId)?.status === 'running'
}

const clearChatCompletionState = (current: AppState, chatId: string): AppState => {
  const runState = getChatRunState(current, chatId)
  if (!runState?.hasUnreadCompletion) return current

  return {
    ...current,
    chatRunStateByChatId: {
      ...current.chatRunStateByChatId,
      [chatId]: {
        ...runState,
        hasUnreadCompletion: false
      }
    }
  }
}

const updateAssistantMessage = (
  current: AppState,
  chatId: string,
  updater: (message: Message) => Message
): AppState => {
  const assistantMessageId = getChatRunState(current, chatId)?.assistantMessageId
  if (!assistantMessageId) return current

  return {
    ...current,
    chats: sortChats(
      current.chats.map((chat) => {
        if (chat.id !== chatId) return chat
        return {
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === assistantMessageId ? updater(message) : message
          )
        }
      })
    )
  }
}

const upsertToolInvocation = (
  tools: ToolInvocation[],
  toolId: string,
  updater: (tool: ToolInvocation | undefined) => ToolInvocation
): ToolInvocation[] => {
  const index = tools.findIndex((tool) => tool.id === toolId)
  if (index === -1) {
    return [...tools, updater(undefined)]
  }

  return tools.map((tool, currentIndex) => (currentIndex === index ? updater(tool) : tool))
}

const getActiveTerminal = (): TerminalSessionSummary | undefined => {
  return state.terminalSessions.find((terminal) => terminal.id === state.activeTerminalId)
}

const scheduleTerminalFit = (): void => {
  if (terminalResizeTick) {
    window.clearTimeout(terminalResizeTick)
  }

  terminalResizeTick = window.setTimeout(() => {
    terminalResizeTick = null
    const activeTerminal = getActiveTerminal()
    if (!activeTerminal || !state.terminalDockOpen) return

    const instance = terminalInstances.get(activeTerminal.id)
    const mount = terminalMounts.get(activeTerminal.id)
    if (!instance || !mount || mount.offsetParent === null) return

    instance.fitAddon.fit()
    void window.api.resizeTerminal({
      terminalId: activeTerminal.id,
      cols: instance.terminal.cols,
      rows: instance.terminal.rows
    })
  }, 30)
}

const focusActiveTerminal = (): void => {
  queueMicrotask(() => {
    const activeTerminal = getActiveTerminal()
    if (!activeTerminal || !state.terminalDockOpen) return
    scheduleTerminalFit()
    terminalInstances.get(activeTerminal.id)?.terminal.focus()
  })
}

const flushPendingTerminalOutput = (terminalId: string): void => {
  const instance = terminalInstances.get(terminalId)
  const queued = pendingTerminalOutput.get(terminalId)
  if (!instance || !queued?.length) return

  for (const chunk of queued) {
    instance.terminal.write(chunk)
  }

  pendingTerminalOutput.delete(terminalId)
}

const ensureTerminalInstance = (terminalId: string, mount: HTMLDivElement): void => {
  terminalMounts.set(terminalId, mount)

  if (!terminalInstances.has(terminalId)) {
    const terminal = new XTerm({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      macOptionIsMeta: true,
      scrollback: 3000,
      theme: {
        background: '#181818',
        foreground: '#e4e4e4',
        cursor: '#82d2ce',
        cursorAccent: '#181818',
        selectionBackground: '#303030',
        black: '#181818',
        red: '#e34671',
        green: '#3fa266',
        yellow: '#f1b467',
        blue: '#81a1c1',
        magenta: '#e394dc',
        cyan: '#82d2ce',
        white: '#e4e4e4',
        brightBlack: '#e4e4e45e',
        brightRed: '#fc6b83',
        brightGreen: '#70b489',
        brightYellow: '#f8c762',
        brightBlue: '#88c0d0',
        brightMagenta: '#aaa0fa',
        brightCyan: '#82d2ce',
        brightWhite: '#ffffff'
      }
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(mount)
    terminal.onData((data) => {
      void window.api.writeTerminal({ terminalId, data })
    })
    terminal.onResize(({ cols, rows }) => {
      void window.api.resizeTerminal({ terminalId, cols, rows })
    })

    terminalInstances.set(terminalId, { terminal, fitAddon })
    flushPendingTerminalOutput(terminalId)
  }

  if (state.activeTerminalId === terminalId && state.terminalDockOpen) {
    scheduleTerminalFit()
  }
}

const disposeTerminalInstance = (terminalId: string): void => {
  terminalMounts.delete(terminalId)
  pendingTerminalOutput.delete(terminalId)
  const instance = terminalInstances.get(terminalId)
  if (!instance) return
  instance.terminal.dispose()
  terminalInstances.delete(terminalId)
}

export const setAppChangeListener = (listener: () => void): void => {
  notifyChange = listener
}

export const setTerminalCleanup = (
  subscribe: (listener: (event: TerminalEvent) => void) => () => void
): void => {
  unsubscribeTerminal?.()
  unsubscribeTerminal = subscribe((event) => {
    if (event.type === 'output') {
      const instance = terminalInstances.get(event.terminalId)
      if (!instance) {
        pendingTerminalOutput.set(event.terminalId, [
          ...(pendingTerminalOutput.get(event.terminalId) ?? []),
          event.data
        ])
        return
      }

      instance.terminal.write(event.data)
      return
    }

    const instance = terminalInstances.get(event.terminalId)
    if (instance) {
      const codeLabel = event.exitCode === null ? 'unknown' : String(event.exitCode)
      instance.terminal.write(`\r\n[process exited ${codeLabel}]\r\n`)
    }

    updateState((current) => ({
      ...current,
      terminalSessions: current.terminalSessions.map((terminal) =>
        terminal.id === event.terminalId
          ? {
              ...terminal,
              status: 'exited',
              exitCode: event.exitCode
            }
          : terminal
      )
    }))
  })
}

export const setChatNotificationCleanup = (
  subscribe: (listener: (event: ChatNotificationClickEvent) => void) => () => void
): void => {
  unsubscribeChatNotificationClick?.()
  unsubscribeChatNotificationClick = subscribe((event) => {
    selectChat(event.chatId)
  })
}

export const setStreamCleanup = (
  subscribe: (listener: (event: AgentStreamEvent) => void) => () => void
): void => {
  unsubscribeStream?.()
  unsubscribeStream = subscribe((event) => {
    let notification:
      | {
          chatId: string
          title: string
          body: string
        }
      | undefined

    updateState((current) => {
      const runState = getChatRunState(current, event.chatId)
      if (!runState) {
        return current
      }

      if (runState.requestId && event.requestId !== runState.requestId) {
        return current
      }

      if (event.type === 'start') {
        return {
          ...current,
          chatRunStateByChatId: {
            ...current.chatRunStateByChatId,
            [event.chatId]: {
              ...runState,
              status: 'running'
            }
          }
        }
      }

      if (event.type === 'text_delta') {
        return updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          content: message.content + event.delta,
          streaming: true
        }))
      }

      if (event.type === 'thinking_delta') {
        return updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          thinking: (message.thinking ?? '') + event.delta,
          streaming: true
        }))
      }

      if (event.type === 'tool_start') {
        return updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          tools: upsertToolInvocation(message.tools ?? [], event.toolCallId, (tool) => ({
            id: event.toolCallId,
            name: event.toolName,
            argsText: tool?.argsText || event.argsText,
            output: tool?.output ?? '',
            status: 'running'
          })),
          streaming: true
        }))
      }

      if (event.type === 'tool_update') {
        return updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          tools: upsertToolInvocation(message.tools ?? [], event.toolCallId, (tool) => ({
            id: event.toolCallId,
            name: event.toolName,
            argsText: tool?.argsText ?? '',
            output: event.output,
            status: 'running'
          })),
          streaming: true
        }))
      }

      if (event.type === 'tool_end') {
        return updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          tools: upsertToolInvocation(message.tools ?? [], event.toolCallId, (tool) => ({
            id: event.toolCallId,
            name: event.toolName,
            argsText: tool?.argsText ?? '',
            output: event.output || tool?.output || '',
            status: event.isError ? 'error' : 'done'
          })),
          streaming: true
        }))
      }

      if (event.type === 'end') {
        const nextState = updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          streaming: false
        }))
        const hasUnreadCompletion = current.activeChatId !== event.chatId
        const completedChat = getChatById(event.chatId, nextState)

        if (hasUnreadCompletion && completedChat) {
          notification = {
            chatId: event.chatId,
            title: completedChat.title,
            body: 'Response finished'
          }
        }

        return {
          ...nextState,
          chats: sortChats(
            nextState.chats.map((updatedChat) =>
              updatedChat.id === event.chatId
                ? {
                    ...updatedChat,
                    updatedAt: now()
                  }
                : updatedChat
            )
          ),
          chatRunStateByChatId: {
            ...nextState.chatRunStateByChatId,
            [event.chatId]: {
              ...runState,
              status: 'completed',
              hasUnreadCompletion
            }
          }
        }
      }

      if (event.type === 'error') {
        const nextState = updateAssistantMessage(current, event.chatId, (message) => ({
          ...message,
          content: message.content || `Agent error: ${event.error}`,
          streaming: false
        }))
        const hasUnreadCompletion = current.activeChatId !== event.chatId
        const errorChat = getChatById(event.chatId, nextState)

        if (hasUnreadCompletion && errorChat) {
          notification = {
            chatId: event.chatId,
            title: errorChat.title,
            body: 'Response ended with an error'
          }
        }

        return {
          ...nextState,
          chats: sortChats(
            nextState.chats.map((updatedChat) =>
              updatedChat.id === event.chatId
                ? {
                    ...updatedChat,
                    updatedAt: now()
                  }
                : updatedChat
            )
          ),
          chatRunStateByChatId: {
            ...nextState.chatRunStateByChatId,
            [event.chatId]: {
              ...runState,
              status: 'error',
              hasUnreadCompletion
            }
          }
        }
      }

      return current
    })

    if (notification) {
      void window.api.showChatNotification(notification)
    }

    if (event.type === 'end' || event.type === 'error') {
      scheduleReviewRefresh({ force: true })
    }
  })
}

const syncTerminalSessions = async (): Promise<void> => {
  const terminals = await window.api.listTerminals()
  updateState((current) => ({
    ...current,
    terminalSessions: terminals,
    activeTerminalId:
      current.activeTerminalId &&
      terminals.some((terminal) => terminal.id === current.activeTerminalId)
        ? current.activeTerminalId
        : (terminals[0]?.id ?? '')
  }))
}

const triggerChange = (): void => {
  notifyChange?.()
}

const persistState = (): void => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspaces: state.workspaces,
        chats: state.chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            thinking: message.thinking ?? '',
            tools: (message.tools ?? []).map((tool) => ({
              id: tool.id,
              name: tool.name,
              argsText: tool.argsText,
              output: tool.output,
              status: tool.status
            }))
          }))
        })),
        activeWorkspacePath: state.activeWorkspacePath,
        activeChatId: state.activeChatId,
        selectedModelId: state.selectedModelId,
        selectedThinkingLevel: state.selectedThinkingLevel
      } satisfies PersistedState)
    )
  } catch (error) {
    console.error('Failed to persist chats', error)
  }
}

const updateState = (updater: (current: AppState) => AppState): void => {
  state = updater(state)
  persistState()
  triggerChange()
  queueMicrotask(syncComposerHeight)
  queueMicrotask(scheduleTerminalFit)
}

const onTerminalResizeStart = (event: MouseEvent): void => {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = state.terminalHeight

  const onMouseMove = (moveEvent: MouseEvent): void => {
    const deltaY = startY - moveEvent.clientY
    const nextHeight = Math.min(
      MAX_TERMINAL_HEIGHT,
      Math.max(MIN_TERMINAL_HEIGHT, startHeight + deltaY)
    )
    updateState((current) => ({ ...current, terminalHeight: nextHeight }))
  }

  const onMouseUp = (): void => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  document.body.style.cursor = 'row-resize'
}

const getActiveWorkspacePath = (): string => {
  return state.activeWorkspacePath
}

const clearReviewSidebar = (): void => {
  updateState((current) => ({
    ...current,
    reviewFiles: [],
    expandedReviewFiles: new Set<string>(),
    reviewLoading: false,
    reviewError: null,
    reviewLastLoadedWorkspacePath: ''
  }))
}

const loadWorkspaceDiff = async (force = false): Promise<void> => {
  const workspacePath = getActiveWorkspacePath()

  if (workspacePath === DEFAULT_WORKSPACE_PATH) {
    clearReviewSidebar()
    return
  }

  if (!state.reviewSidebarOpen && !force) return
  if (
    !force &&
    state.reviewLastLoadedWorkspacePath === workspacePath &&
    !state.reviewLoading &&
    !state.reviewError
  ) {
    return
  }

  const requestId = ++reviewRefreshRequestId
  updateState((current) => ({
    ...current,
    reviewLoading: true,
    reviewError: null
  }))

  const result = await window.api.getWorkspaceDiff({ cwd: workspacePath })

  if (requestId !== reviewRefreshRequestId) {
    return
  }

  if (!result.ok) {
    updateState((current) => {
      if (current.activeWorkspacePath !== workspacePath) {
        return current
      }

      return {
        ...current,
        reviewFiles: [],
        expandedReviewFiles: new Set<string>(),
        reviewLoading: false,
        reviewError: result.error,
        reviewLastLoadedWorkspacePath: workspacePath
      }
    })
    return
  }

  updateState((current) => {
    if (current.activeWorkspacePath !== workspacePath) {
      return current
    }

    const nextExpanded = new Set(
      [...current.expandedReviewFiles].filter((path) =>
        result.files.some((reviewFile) => reviewFile.path === path)
      )
    )

    return {
      ...current,
      reviewFiles: result.files,
      expandedReviewFiles: nextExpanded,
      reviewLoading: false,
      reviewError: null,
      reviewLastLoadedWorkspacePath: workspacePath
    }
  })
}

const scheduleReviewRefresh = ({
  force = false,
  immediate = false
}: {
  force?: boolean
  immediate?: boolean
} = {}): void => {
  if (reviewRefreshTick) {
    window.clearTimeout(reviewRefreshTick)
    reviewRefreshTick = null
  }

  if (immediate) {
    void loadWorkspaceDiff(force)
    return
  }

  reviewRefreshTick = window.setTimeout(() => {
    reviewRefreshTick = null
    void loadWorkspaceDiff(force)
  }, REVIEW_REFRESH_DEBOUNCE_MS)
}

const syncAuthState = async (): Promise<void> => {
  const authState = await window.api.getAuthState()
  updateState((current) => {
    const selectedModelId = authState.models.some((model) => model.id === current.selectedModelId)
      ? current.selectedModelId
      : authState.defaultModelId
    const selectedModel = authState.models.find((model) => model.id === selectedModelId)
    const thinkingLevels = selectedModel?.thinkingLevels ?? ['off']

    return {
      ...current,
      authChecked: true,
      loggedIn: authState.loggedIn,
      models: authState.models,
      selectedModelId,
      selectedThinkingLevel: thinkingLevels.includes(current.selectedThinkingLevel)
        ? current.selectedThinkingLevel
        : getDefaultThinkingLevel(thinkingLevels)
    }
  })
}

const setComposer = (value: string): void => {
  state = {
    ...state,
    composer: value
  }
  triggerChange()
  queueMicrotask(syncComposerHeight)
}

const removeComposerImage = (imageId: string): void => {
  updateState((current) => {
    const image = current.composerImages.find((entry) => entry.id === imageId)
    if (!image) return current

    URL.revokeObjectURL(image.previewUrl)
    return {
      ...current,
      composerImages: current.composerImages.filter((entry) => entry.id !== imageId)
    }
  })
}

const handleComposerImageFiles = async (files: FileList | null): Promise<void> => {
  if (!files || files.length === 0) return

  const nextImages: ComposerImage[] = []
  for (const file of Array.from(files)) {
    try {
      const image = await createComposerImageFromFile(file)
      if (image) {
        nextImages.push(image)
      }
    } catch (error) {
      console.error(error)
    }
  }

  if (nextImages.length === 0) return

  updateState((current) => ({
    ...current,
    composerImages: [...current.composerImages, ...nextImages]
  }))
}

const openComposerImagePicker = (): void => {
  composerFileInput?.click()
}

const resetComposerImages = (current: AppState): AppState => {
  if (current.composerImages.length > 0) {
    revokeComposerImagePreviews(current.composerImages)
  }

  return {
    ...current,
    composerImages: []
  }
}

const setSelectedModelId = (value: string): void => {
  updateState((current) => ({
    ...current,
    selectedModelId: value,
    selectedThinkingLevel: (
      current.models.find((model) => model.id === value)?.thinkingLevels ?? ['off']
    ).includes(current.selectedThinkingLevel)
      ? current.selectedThinkingLevel
      : getDefaultThinkingLevel(
          current.models.find((model) => model.id === value)?.thinkingLevels ?? ['off']
        )
  }))
}

const setSelectedThinkingLevel = (value: ThinkingLevel): void => {
  updateState((current) => ({
    ...current,
    selectedThinkingLevel: value
  }))
}

const getActiveWorkspace = (): Workspace => {
  return getWorkspaceByPath(state.workspaces, state.activeWorkspacePath)
}

const getActiveChat = (): Chat | undefined => {
  return state.chats.find((chat) => chat.id === state.activeChatId)
}

const getChatById = (chatId: string, current: AppState = state): Chat | undefined => {
  return current.chats.find((chat) => chat.id === chatId)
}

const createChatForWorkspace = (workspacePath: string): void => {
  if (workspacePath === DEFAULT_WORKSPACE_PATH || !state.loggedIn) return

  const workspace = getWorkspaceByPath(state.workspaces, workspacePath)
  if (workspace.path === DEFAULT_WORKSPACE_PATH) return

  const chat = createChat(workspace)
  updateState((current) => {
    const next = resetComposerImages(current)
    return {
      ...next,
      activeWorkspacePath: workspace.path,
      activeChatId: chat.id,
      chats: sortChats([chat, ...next.chats]),
      composer: ''
    }
  })
  focusComposer()
  scrollActiveChatToBottom()
  scheduleReviewRefresh({ immediate: true, force: true })
}

const createNewChat = (): void => {
  createChatForWorkspace(getActiveWorkspace().path)
}

const selectChat = (chatId: string): void => {
  updateState((current) => {
    const chat = current.chats.find((entry) => entry.id === chatId)
    if (!chat) return current

    return clearChatCompletionState(
      {
        ...current,
        activeWorkspacePath: chat.workspacePath,
        activeChatId: chatId
      },
      chatId
    )
  })
  focusComposer()
  scrollActiveChatToBottom()
  scheduleReviewRefresh({ immediate: true, force: true })
}

const toggleWorkspaceExpanded = (workspacePath: string): void => {
  updateState((current) => {
    const expanded = new Set(current.expandedWorkspaces)
    if (expanded.has(workspacePath)) {
      expanded.delete(workspacePath)
    } else {
      expanded.add(workspacePath)
    }
    return {
      ...current,
      expandedWorkspaces: expanded
    }
  })
}

const toggleSidebar = (): void => {
  state = {
    ...state,
    sidebarCollapsed: !state.sidebarCollapsed
  }
  triggerChange()
}

const toggleReviewSidebar = (): void => {
  const nextOpen = !state.reviewSidebarOpen

  updateState((current) => ({
    ...current,
    reviewSidebarOpen: nextOpen
  }))

  if (nextOpen) {
    scheduleReviewRefresh({ immediate: true, force: true })
  }
}

const toggleReviewFileExpanded = (path: string): void => {
  updateState((current) => {
    const expandedReviewFiles = new Set(current.expandedReviewFiles)
    if (expandedReviewFiles.has(path)) {
      expandedReviewFiles.delete(path)
    } else {
      expandedReviewFiles.add(path)
    }

    return {
      ...current,
      expandedReviewFiles
    }
  })
}

const setActiveTerminal = (terminalId: string): void => {
  updateState((current) => ({
    ...current,
    activeTerminalId: terminalId
  }))
  focusActiveTerminal()
}

const closeTerminal = async (terminalId: string): Promise<void> => {
  await window.api.closeTerminal({ terminalId })
  disposeTerminalInstance(terminalId)

  updateState((current) => {
    const terminalSessions = current.terminalSessions.filter(
      (terminal) => terminal.id !== terminalId
    )
    const activeTerminalId =
      current.activeTerminalId === terminalId
        ? (terminalSessions[0]?.id ?? '')
        : current.activeTerminalId

    return {
      ...current,
      terminalSessions,
      activeTerminalId,
      terminalDockOpen: terminalSessions.length > 0 ? current.terminalDockOpen : false
    }
  })

  if (!state.activeTerminalId) {
    focusComposer()
  } else {
    focusActiveTerminal()
  }
}

const createTerminal = async (): Promise<void> => {
  const activeWorkspace = getActiveWorkspace()
  const result = await window.api.createTerminal({
    cwd: activeWorkspace.path !== DEFAULT_WORKSPACE_PATH ? activeWorkspace.path : undefined,
    title:
      activeWorkspace.path !== DEFAULT_WORKSPACE_PATH ? `${activeWorkspace.name} shell` : undefined
  })

  if (!result.ok) {
    console.error('Failed to create terminal', result.error)
    return
  }

  updateState((current) => ({
    ...current,
    terminalDockOpen: true,
    terminalSessions: [...current.terminalSessions, result.terminal],
    activeTerminalId: result.terminal.id
  }))

  focusActiveTerminal()
}

const openTerminalDock = async (): Promise<void> => {
  if (state.terminalDockOpen && state.terminalSessions.length > 0) {
    focusActiveTerminal()
    return
  }

  if (state.terminalSessions.length === 0) {
    await createTerminal()
    return
  }

  updateState((current) => ({
    ...current,
    terminalDockOpen: true
  }))
  focusActiveTerminal()
}

const toggleTerminalDock = async (): Promise<void> => {
  if (state.terminalDockOpen) {
    updateState((current) => ({
      ...current,
      terminalDockOpen: false
    }))
    focusComposer()
    return
  }

  await openTerminalDock()
}

const openDeleteChatDialog = (chatId: string): void => {
  updateState((current) => ({
    ...current,
    deleteChatId: chatId
  }))
}

const openSettingsDialog = (): void => {
  updateState((current) => ({
    ...current,
    settingsDialogOpen: true
  }))
}

const closeSettingsDialog = (): void => {
  updateState((current) => ({
    ...current,
    settingsDialogOpen: false
  }))
}

const closeDeleteChatDialog = (): void => {
  updateState((current) => ({
    ...current,
    deleteChatId: null
  }))
}

const confirmDeleteChat = (): void => {
  const targetChatId = state.deleteChatId
  if (!targetChatId || isChatRunning(targetChatId)) return

  updateState((current) => {
    const chatToDelete = current.chats.find((chat) => chat.id === targetChatId)
    if (!chatToDelete) {
      return {
        ...current,
        deleteChatId: null
      }
    }

    const chats = sortChats(current.chats.filter((chat) => chat.id !== targetChatId))
    const workspaceChats = getChatsForWorkspace(chatToDelete.workspacePath, chats)
    const fallbackChat = workspaceChats[0]
    const nextChatRunStateByChatId = { ...current.chatRunStateByChatId }
    delete nextChatRunStateByChatId[targetChatId]

    return {
      ...current,
      chats,
      chatRunStateByChatId: nextChatRunStateByChatId,
      activeWorkspacePath: chatToDelete.workspacePath,
      activeChatId:
        current.activeChatId === targetChatId ? (fallbackChat?.id ?? '') : current.activeChatId,
      deleteChatId: null
    }
  })
}

const openFolder = async (): Promise<void> => {
  if (folderPickerInFlight || !state.loggedIn) return
  folderPickerInFlight = true

  try {
    const folder = await window.api.openFolder()
    if (!folder) return

    updateState((current) => {
      const workspace = current.workspaces.find((entry) => entry.path === folder.path) ?? {
        path: folder.path,
        name: folder.name,
        createdAt: now()
      }

      const workspaces = current.workspaces.some((entry) => entry.path === folder.path)
        ? current.workspaces
        : [workspace, ...current.workspaces].sort((a, b) => b.createdAt - a.createdAt)

      const existingChats = getChatsForWorkspace(folder.path, current.chats)
      const activeChat = existingChats[0] ?? createChat(workspace)
      const chats = existingChats[0] ? current.chats : sortChats([activeChat, ...current.chats])

      const next = resetComposerImages(current)
      return clearChatCompletionState(
        {
          ...next,
          workspaces,
          chats,
          activeWorkspacePath: folder.path,
          activeChatId: activeChat.id,
          composer: ''
        },
        activeChat.id
      )
    })
    focusComposer()
    scrollActiveChatToBottom()
    scheduleReviewRefresh({ immediate: true, force: true })
  } finally {
    folderPickerInFlight = false
  }
}

const sendMessage = async (): Promise<void> => {
  const activeChat = getActiveChat()
  const workspace = getActiveWorkspace()
  const content = state.composer.trim()
  const composerImages = state.composerImages

  if (
    (!content && composerImages.length === 0) ||
    !activeChat ||
    state.models.length === 0 ||
    workspace.path === DEFAULT_WORKSPACE_PATH ||
    isChatRunning(activeChat.id) ||
    !state.loggedIn
  ) {
    return
  }

  const imageNames = composerImages.map((image) => image.name)
  const attachmentSummary = imageNames.length > 0 ? `Attached images: ${imageNames.join(', ')}` : ''
  const prompt = content || 'Please analyze the attached image(s).'
  const userContent = [content, attachmentSummary].filter(Boolean).join('\n\n')
  const images: PromptImageAttachment[] = composerImages.map((image) => ({
    type: 'image',
    mimeType: image.mimeType,
    data: image.data,
    name: image.name
  }))

  const userMessage: Message = {
    id: createId(),
    role: 'user',
    content: userContent,
    createdAt: now()
  }

  const assistantMessageId = createId()
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    createdAt: now(),
    streaming: true,
    thinking: '',
    tools: []
  }

  updateState((current) => ({
    ...current,
    chats: sortChats(
      current.chats.map((chat) => {
        if (chat.id !== activeChat.id) return chat
        return {
          ...chat,
          title:
            chat.messages.length <= 1
              ? getChatTitleFromInput(content || imageNames[0] || 'New chat')
              : chat.title,
          messages: [...chat.messages, userMessage, assistantMessage],
          updatedAt: userMessage.createdAt
        }
      })
    ),
    composer: '',
    composerImages: [],
    chatRunStateByChatId: {
      ...current.chatRunStateByChatId,
      [activeChat.id]: {
        status: 'running',
        requestId: null,
        assistantMessageId,
        hasUnreadCompletion: false
      }
    }
  }))
  revokeComposerImagePreviews(composerImages)

  const result = await window.api.sendChatMessage({
    chatId: activeChat.id,
    cwd: workspace.path,
    prompt,
    images,
    modelId: state.selectedModelId,
    thinkingLevel: state.selectedThinkingLevel
  })

  if (!result.ok) {
    updateState((current) => ({
      ...current,
      chats: sortChats(
        current.chats.map((chat) => {
          if (chat.id !== activeChat.id) return chat
          return {
            ...chat,
            messages: chat.messages.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: `Agent error: ${result.error}`, streaming: false }
                : message
            ),
            updatedAt: now()
          }
        })
      ),
      chatRunStateByChatId: {
        ...current.chatRunStateByChatId,
        [activeChat.id]: {
          status: 'error',
          requestId: null,
          assistantMessageId,
          hasUnreadCompletion: false
        }
      }
    }))
    return
  }

  updateState((current) => {
    const runState = getChatRunState(current, activeChat.id)
    if (!runState || runState.assistantMessageId !== assistantMessageId) {
      return current
    }

    return {
      ...current,
      chatRunStateByChatId: {
        ...current.chatRunStateByChatId,
        [activeChat.id]: {
          ...runState,
          requestId: result.requestId
        }
      }
    }
  })
}

const onGlobalKeyDown = (event: KeyboardEvent): void => {
  const modifier = event.metaKey || event.ctrlKey
  const target = event.target as HTMLElement | null
  const isTextInput =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target?.isContentEditable === true

  if (modifier && event.code === 'KeyA' && target instanceof HTMLTextAreaElement) {
    event.preventDefault()
    target.select()
    return
  }

  if (modifier && event.key === 'Enter' && state.loggedIn) {
    event.preventDefault()
    void sendMessage()
    return
  }

  if (modifier && event.altKey && event.code === 'KeyB' && state.loggedIn) {
    event.preventDefault()
    toggleReviewSidebar()
    return
  }

  if (modifier && event.code === 'KeyB' && state.loggedIn) {
    event.preventDefault()
    toggleSidebar()
    return
  }

  if (event.metaKey && event.key === ',' && state.loggedIn) {
    event.preventDefault()
    openSettingsDialog()
    return
  }

  if (modifier && event.code === 'KeyJ' && state.loggedIn) {
    event.preventDefault()
    void toggleTerminalDock()
    return
  }

  if (modifier && event.code === 'KeyN' && state.loggedIn) {
    event.preventDefault()
    createNewChat()
    return
  }

  if (modifier && event.code === 'KeyO' && state.loggedIn && !isTextInput) {
    event.preventDefault()
    void openFolder()
    return
  }

  if (modifier && event.shiftKey && event.code === 'KeyM' && state.loggedIn) {
    event.preventDefault()
    const btn = document.querySelector('.model-select-btn') as HTMLButtonElement | null
    if (btn) btn.click()
    return
  }

  if (modifier && !event.shiftKey && !event.altKey && event.code === 'KeyT' && state.loggedIn) {
    event.preventDefault()
    const btn = document.querySelector('.thinking-select-btn') as HTMLButtonElement | null
    if (btn) btn.click()
    return
  }
}

const renderTablerPlus = (className = 'h-4 w-4'): TemplateResult => html`
  <svg
    class=${className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
`

const renderChatStatusIndicator = (chatId: string, isActive: boolean): TemplateResult => {
  const runState = getChatRunState(state, chatId)
  const isRunning = runState?.status === 'running'
  const showCompleted = Boolean(runState?.hasUnreadCompletion && !isActive)

  return html`
    <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      ${isRunning
        ? icon(LoaderCircle, 'xs', 'h-3.5 w-3.5 animate-spin text-[var(--vector-primary)]')
        : showCompleted
          ? html`<span class="h-1.5 w-1.5 rounded-full bg-[var(--vector-interactive)]"></span>`
          : ''}
    </span>
  `
}

const renderChatList = (workspace: Workspace, activeChatId: string): TemplateResult => {
  const chats = getChatsForWorkspace(workspace.path, state.chats)

  return html`
    <div class="space-y-1 pl-7">
      ${chats.map((chat) => {
        const isActive = chat.id === activeChatId
        const canDelete = !isChatRunning(chat.id)

        return html`
          <div class="group relative">
            <button
              type="button"
              class=${[
                'flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors',
                isActive
                  ? 'bg-[var(--vector-surface-active)]'
                  : 'bg-transparent hover:bg-[var(--vector-surface-hover)]'
              ].join(' ')}
              @click=${() => selectChat(chat.id)}
            >
              <span class="flex min-w-0 items-center gap-2">
                ${renderChatStatusIndicator(chat.id, isActive)}
                <span
                  class="min-w-0 truncate text-[13px] font-medium leading-none text-[var(--vector-text)]"
                >
                  ${chat.title}
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                ${canDelete
                  ? html`
                      <button
                        type="button"
                        class="flex h-5 w-5 items-center justify-center text-[var(--vector-text-muted)] opacity-0 transition-all group-hover:opacity-100 hover:text-[var(--vector-error)]"
                        title="Delete chat"
                        @click=${(event: Event) => {
                          event.stopPropagation()
                          openDeleteChatDialog(chat.id)
                        }}
                      >
                        ${icon(Trash2, 'xs')}
                      </button>
                    `
                  : ''}
                <span class="text-[13px] leading-none text-[var(--vector-text-muted)]">
                  ${formatRelativeTime(chat.updatedAt)}
                </span>
              </span>
            </button>
          </div>
        `
      })}
    </div>
  `
}

const renderSidebar = (activeWorkspace: Workspace, activeChatId: string): TemplateResult => {
  return html`
    <div class="flex h-full">
      ${state.sidebarCollapsed
        ? ''
        : html`
            <aside
              class="m-1.5 mr-1 flex h-[calc(100%-12px)] w-[252px] min-w-[252px] flex-col rounded-xl border border-[var(--vector-border)] bg-[var(--vector-surface)] shadow-xl shadow-black/20 px-1 py-3"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--vector-text)] transition-colors hover:bg-[var(--vector-surface-hover)]"
                ?disabled=${activeWorkspace.path === DEFAULT_WORKSPACE_PATH}
                @click=${() => createNewChat()}
              >
                ${icon(SquarePen, 'sm')}
                <span class="text-[15px] font-medium leading-none">New Thread</span>
              </button>

              <div class="mt-2 flex items-center justify-between px-3 pb-1 pt-2">
                <span class="text-[13px] font-medium leading-none text-[var(--vector-text-muted)]"
                  >Threads</span
                >
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--vector-text)] transition-colors hover:bg-[var(--vector-surface-hover)]"
                  title="Add New Project (Cmd/Ctrl + O)"
                  @click=${() => void openFolder()}
                >
                  ${icon(FolderPlus, 'sm')}
                </button>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div class="space-y-1">
                  ${state.workspaces.length === 0
                    ? html`
                        <p class="px-3 pt-3 text-[13px] leading-5 text-[var(--vector-text-muted)]">
                          Open a folder with Cmd/Ctrl + O to create your first project.
                        </p>
                      `
                    : state.workspaces.map((workspace) => {
                        const isExpanded = state.expandedWorkspaces.has(workspace.path)

                        return html`
                          <section class="space-y-1">
                            <div class="flex items-center gap-1 px-2 py-1">
                              <button
                                type="button"
                                class="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left"
                                @click=${() => toggleWorkspaceExpanded(workspace.path)}
                              >
                                ${icon(
                                  isExpanded ? FolderOpen : Folder,
                                  'sm',
                                  'shrink-0 text-[var(--vector-text)]'
                                )}
                                <span
                                  class="truncate text-[15px] font-semibold leading-none text-[var(--vector-text)]"
                                >
                                  ${workspace.name}
                                </span>
                              </button>

                              <button
                                type="button"
                                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--vector-text-muted)] transition-colors hover:bg-[var(--vector-surface-hover)] hover:text-[var(--vector-text)]"
                                title="New chat in ${workspace.name}"
                                @click=${(event: Event) => {
                                  event.stopPropagation()
                                  createChatForWorkspace(workspace.path)
                                }}
                              >
                                ${renderTablerPlus('h-4 w-4')}
                              </button>
                            </div>

                            ${isExpanded ? renderChatList(workspace, activeChatId) : ''}
                          </section>
                        `
                      })}
                </div>
              </div>

              <div class="mt-auto px-2 pt-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--vector-text)] transition-colors hover:bg-[var(--vector-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  @click=${openSettingsDialog}
                >
                  ${icon(Settings, 'sm')}
                  <span class="text-[15px] font-medium leading-none">Settings</span>
                </button>
              </div>
            </aside>
          `}
    </div>
  `
}

const renderReviewChevron = (className = 'h-3.5 w-3.5'): TemplateResult => html`
  <svg
    class=${className}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M4.5 6.25 8 9.75l3.5-3.5"
      stroke="currentColor"
      stroke-width="1.35"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`

const formatReviewLineNumber = (value: number | null): string => {
  return value === null ? '' : String(value)
}

const getReviewDiffRows = (reviewFile: ReviewFile): ReviewDiffRow[] => {
  const rows: ReviewDiffRow[] = []
  let leftLineNumber = 1
  let rightLineNumber = 1

  for (const part of DiffLib.diffLines(reviewFile.oldText ?? '', reviewFile.newText ?? '')) {
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (const line of lines) {
      if (part.added) {
        rows.push({
          kind: 'add',
          text: line,
          leftLineNumber: null,
          rightLineNumber
        })
        rightLineNumber += 1
        continue
      }

      if (part.removed) {
        rows.push({
          kind: 'remove',
          text: line,
          leftLineNumber,
          rightLineNumber: null
        })
        leftLineNumber += 1
        continue
      }

      rows.push({
        kind: 'context',
        text: line,
        leftLineNumber,
        rightLineNumber
      })
      leftLineNumber += 1
      rightLineNumber += 1
    }
  }

  const changedIndexes = rows.flatMap((row, index) => (row.kind === 'context' ? [] : [index]))
  if (changedIndexes.length === 0) {
    return rows.slice(0, 40)
  }

  const includedIndexes = new Set<number>()

  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - REVIEW_DIFF_CONTEXT_LINES)
    const end = Math.min(rows.length - 1, changedIndex + REVIEW_DIFF_CONTEXT_LINES)
    for (let index = start; index <= end; index += 1) {
      includedIndexes.add(index)
    }
  }

  const collapsedRows: ReviewDiffRow[] = []
  let previousIncludedIndex: number | null = null

  for (let index = 0; index < rows.length; index += 1) {
    if (!includedIndexes.has(index)) {
      continue
    }

    if (previousIncludedIndex !== null && index - previousIncludedIndex > 1) {
      const skippedLines = index - previousIncludedIndex - 1
      collapsedRows.push({
        kind: 'ellipsis',
        text: `${skippedLines} unchanged line${skippedLines === 1 ? '' : 's'}`,
        leftLineNumber: null,
        rightLineNumber: null
      })
    }

    collapsedRows.push(rows[index])
    previousIncludedIndex = index
  }

  return collapsedRows
}

const renderReviewDiff = (reviewFile: ReviewFile): TemplateResult => {
  const rows = getReviewDiffRows(reviewFile)

  return html`
    <div class="max-h-[460px] overflow-auto">
      ${rows.map((row) => {
        if (row.kind === 'ellipsis') {
          return html`
            <div
              class="border-y border-[var(--vector-border)] bg-[var(--vector-surface-raised)] px-4 py-1.5 text-center text-[11px] text-[var(--vector-text-muted)]"
            >
              ${row.text}
            </div>
          `
        }

        const rowTone =
          row.kind === 'add'
            ? 'bg-[color-mix(in_srgb,var(--vector-diff-add)_18%,transparent)]'
            : row.kind === 'remove'
              ? 'bg-[color-mix(in_srgb,var(--vector-diff-delete)_16%,transparent)]'
              : 'bg-transparent'

        return html`
          <div
            class=${[
              'grid grid-cols-[56px_56px_minmax(0,1fr)] items-start gap-0 border-b border-[var(--vector-border)] text-[12px] leading-5',
              rowTone
            ].join(' ')}
          >
            <div class="select-none px-3 py-1 text-right font-mono text-[var(--vector-text-muted)]">
              ${formatReviewLineNumber(row.leftLineNumber)}
            </div>
            <div class="select-none px-3 py-1 text-right font-mono text-[var(--vector-text-muted)]">
              ${formatReviewLineNumber(row.rightLineNumber)}
            </div>
            <pre class="m-0 overflow-x-auto px-3 py-1 font-mono text-[var(--vector-text)]">
${row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '}${row.text}</pre
            >
          </div>
        `
      })}
    </div>
  `
}

const renderReviewSidebar = (activeWorkspace: Workspace): TemplateResult => {
  if (!state.reviewSidebarOpen) {
    return html``
  }

  const hasWorkspace = activeWorkspace.path !== DEFAULT_WORKSPACE_PATH
  const hasFiles = state.reviewFiles.length > 0

  return html`
    <aside
      class="m-1.5 ml-1 flex h-[calc(100%-12px)] shrink-0 flex-col rounded-xl border border-[var(--vector-border)] bg-[var(--vector-surface)] shadow-xl shadow-black/20"
      style=${`width: ${REVIEW_SIDEBAR_WIDTH}px; min-width: ${REVIEW_SIDEBAR_WIDTH}px;`}
    >
      <div
        class="flex items-start justify-between gap-3 border-b border-[var(--vector-border-strong)] px-4 pb-3 pt-4"
      >
        <div class="min-w-0">
          <div class="text-[var(--vector-text)]">
            <span class="text-[15px] font-semibold">Review changes</span>
          </div>
          <p class="mt-1 text-[12px] leading-5 text-[var(--vector-text-muted)]">
            ${hasWorkspace
              ? `${state.reviewFiles.length} file${state.reviewFiles.length === 1 ? '' : 's'} in ${activeWorkspace.name}`
              : 'Open a workspace to review changes'}
          </p>
        </div>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--vector-text-muted)] transition-colors hover:bg-[var(--vector-surface-hover)] hover:text-[var(--vector-text)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Refresh review"
            ?disabled=${!hasWorkspace || state.reviewLoading}
            @click=${() => scheduleReviewRefresh({ immediate: true, force: true })}
          >
            ${icon(RefreshCw, 'sm', state.reviewLoading ? 'animate-spin' : '')}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        ${!hasWorkspace
          ? html`
              <div
                class="rounded-2xl border border-dashed border-[var(--vector-border-strong)] px-4 py-5 text-sm text-[var(--vector-text-muted)]"
              >
                Open a git workspace to review changes inside the app.
              </div>
            `
          : state.reviewError
            ? html`
                <div
                  class="rounded-2xl border border-[color-mix(in_srgb,var(--vector-error)_45%,transparent)] bg-[color-mix(in_srgb,var(--vector-error)_15%,transparent)] px-4 py-5 text-sm text-[var(--vector-error)]"
                >
                  ${state.reviewError}
                </div>
              `
            : state.reviewLoading && !hasFiles
              ? html`
                  <div
                    class="flex items-center gap-3 rounded-2xl border border-[var(--vector-border-strong)] px-4 py-5 text-sm text-[var(--vector-text-muted)]"
                  >
                    ${icon(LoaderCircle, 'sm', 'animate-spin')}
                    <span>Loading workspace diff…</span>
                  </div>
                `
              : !hasFiles
                ? html`
                    <div
                      class="rounded-2xl border border-dashed border-[var(--vector-border-strong)] px-4 py-5 text-sm text-[var(--vector-text-muted)]"
                    >
                      No uncommitted file changes in this workspace.
                    </div>
                  `
                : html`
                    <div
                      class="overflow-hidden rounded-2xl border border-[var(--vector-border-strong)] bg-[var(--vector-surface-raised)]"
                    >
                      ${repeat(
                        state.reviewFiles,
                        (reviewFile) => reviewFile.path,
                        (reviewFile, index) => {
                          const isExpanded = state.expandedReviewFiles.has(reviewFile.path)

                          return html`
                            <section
                              class=${index > 0
                                ? 'border-t border-[var(--vector-border-strong)]'
                                : ''}
                            >
                              <button
                                type="button"
                                class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--vector-surface-hover)]"
                                @click=${() => toggleReviewFileExpanded(reviewFile.path)}
                              >
                                <div class="flex min-w-0 items-center gap-3">
                                  <div
                                    class="truncate text-[13px] font-semibold text-[var(--vector-text)]"
                                  >
                                    ${reviewFile.path}
                                  </div>
                                  <div
                                    class="flex shrink-0 items-center gap-2 text-[11px] text-[var(--vector-text-muted)]"
                                  >
                                    <span class="text-[var(--vector-diff-add)]"
                                      >+${reviewFile.added}</span
                                    >
                                    <span class="text-[var(--vector-diff-delete)]"
                                      >-${reviewFile.removed}</span
                                    >
                                  </div>
                                </div>

                                <span
                                  class=${[
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--vector-surface-active)] text-[var(--vector-text-muted)] transition-transform',
                                    isExpanded ? 'rotate-180' : ''
                                  ].join(' ')}
                                >
                                  ${renderReviewChevron()}
                                </span>
                              </button>

                              ${isExpanded
                                ? html`
                                    <div
                                      class="border-t border-[var(--vector-border-strong)] px-3 py-3"
                                    >
                                      ${renderReviewDiff(reviewFile)}
                                    </div>
                                  `
                                : ''}
                            </section>
                          `
                        }
                      )}
                    </div>
                  `}
      </div>
    </aside>
  `
}

const renderNoWorkspaceState = (): TemplateResult => {
  return html`
    <div class="flex h-full items-center justify-center px-8 text-center">
      <div class="max-w-md space-y-3">
        <div class="text-2xl font-semibold text-[var(--vector-text)]">
          Open a workspace to start
        </div>
        <p class="text-sm leading-6 text-[var(--vector-text-muted)]">
          Use the folder-plus action or press Cmd/Ctrl + O. Only the conversation area scrolls.
        </p>
      </div>
    </div>
  `
}

const renderToolInvocation = (tool: ToolInvocation): TemplateResult => {
  const statusTone =
    tool.status === 'error' ? 'text-[var(--vector-error)]' : 'text-[var(--vector-text-muted)]'
  const statusLabel = tool.status === 'error' ? 'error' : tool.status === 'running' ? 'running' : ''

  let args: Record<string, string> = {}
  try {
    args = JSON.parse(tool.argsText || '{}') as Record<string, string>
  } catch {
    // Fallback if not valid JSON
  }

  const renderHeader = (label: string | TemplateResult): TemplateResult => html`
    <div class="flex items-center gap-1.5 py-1 text-[var(--vector-text-muted)] select-none">
      <span class="text-[13px] font-medium text-[var(--vector-text)]">${label}</span>
      ${statusLabel
        ? html`<span class=${['text-[12px] font-medium', statusTone].join(' ')}
            >${statusLabel}</span
          >`
        : ''}
    </div>
  `

  if (tool.name === 'bash') {
    return html`
      <details class="overflow-hidden" ?open=${false}>
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[var(--vector-text-muted)]"
        >
          <span class="text-[13px] font-medium text-[var(--vector-text)]"
            >bash ${args.command || ''}</span
          >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 transition-transform details-arrow"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          ${statusLabel
            ? html`<span class=${['text-[12px] font-medium', statusTone].join(' ')}
                >${statusLabel}</span
              >`
            : ''}
        </summary>
        <div class="pt-2">
          ${tool.output
            ? html`<pre
                class="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--vector-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--vector-text)]"
              >
${tool.output}</pre
              >`
            : tool.status === 'running'
              ? html`<div class="mt-3 text-xs text-[var(--vector-text-muted)]">
                  Waiting for output…
                </div>`
              : ''}
        </div>
      </details>
    `
  }

  if (tool.name === 'read') {
    return renderHeader(
      html`read <span class="text-[var(--vector-info)]">${args.path || ''}</span>`
    )
  }

  if (tool.name === 'ls') {
    return renderHeader(html`ls <span class="text-[var(--vector-info)]">${args.path || '.'}</span>`)
  }

  if (tool.name === 'find') {
    return renderHeader(
      html`find <span class="text-[var(--vector-info)]">${args.pattern || ''}</span> in
        ${args.path || '.'}`
    )
  }

  if (tool.name === 'grep') {
    return renderHeader(
      html`grep <span class="text-[var(--vector-info)]">${args.pattern || ''}</span> in
        ${args.path || '.'}`
    )
  }

  if (tool.name === 'write') {
    const lines = (args.content || '').split('\n').length
    return renderHeader(
      html`write <span class="text-[var(--vector-info)]">${args.path || ''}</span>
        <span class="text-[var(--vector-diff-add)]">+${lines}</span>`
    )
  }

  if (tool.name === 'edit') {
    const added = (args.newText || '').split('\n').length
    const removed = (args.oldText || '').split('\n').length
    return renderHeader(
      html`edit <span class="text-[var(--vector-info)]">${args.path || ''}</span>
        <span class="text-[var(--vector-diff-add)]">+${added}</span>
        <span class="text-[var(--vector-diff-delete)]">-${removed}</span>`
    )
  }

  return html`
    <details class="overflow-hidden" ?open=${false}>
      <summary
        class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[var(--vector-text-muted)]"
      >
        <span class="text-[13px] font-medium text-[var(--vector-text)]">${tool.name}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="shrink-0 transition-transform details-arrow"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        ${statusLabel
          ? html`<span class=${['text-[12px] font-medium', statusTone].join(' ')}
              >${statusLabel}</span
            >`
          : ''}
      </summary>
      <div class="pt-2">
        ${tool.argsText
          ? html`<pre
              class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--vector-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--vector-text-muted)]"
            >
${tool.argsText}</pre
            >`
          : ''}
        ${tool.output
          ? html`<pre
              class="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--vector-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--vector-text)]"
            >
${tool.output}</pre
            >`
          : tool.status === 'running'
            ? html`<div class="mt-3 text-xs text-[var(--vector-text-muted)]">
                Waiting for output…
              </div>`
            : ''}
      </div>
    </details>
  `
}

const renderMessage = (message: Message): TemplateResult => {
  const isAssistant = message.role === 'assistant'
  const hasThinking = Boolean(message.thinking?.trim())
  const tools = message.tools ?? []

  return html`
    <div class=${['flex w-full', isAssistant ? 'justify-start' : 'justify-end'].join(' ')}>
      ${isAssistant
        ? html`
            <div
              class="max-w-[640px] space-y-3 text-[15px] leading-[1.55] text-[var(--vector-text)]"
            >
              ${hasThinking
                ? html`
                    <details class="overflow-hidden" ?open=${message.streaming && !message.content}>
                      <summary
                        class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[var(--vector-text-muted)]"
                      >
                        <span class="text-[13px] font-medium">Thinking</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="shrink-0 transition-transform details-arrow"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </summary>
                      <div class="pt-2">
                        <markdown-block .content=${message.thinking}></markdown-block>
                      </div>
                    </details>
                  `
                : ''}
              ${tools.length > 0
                ? html`<div class="space-y-1">
                    ${tools.map((tool) => renderToolInvocation(tool))}
                  </div>`
                : ''}
              ${message.content
                ? html`<markdown-block .content=${message.content}></markdown-block>`
                : ''}
              ${message.streaming
                ? html`
                    <div
                      class="mt-2 flex items-center gap-2 text-xs text-[var(--vector-text-muted)]"
                    >
                      ${icon(LoaderCircle, 'xs', 'animate-spin')}
                      <span>Responding</span>
                    </div>
                  `
                : ''}
            </div>
          `
        : html`
            <div
              class="max-w-[360px] rounded-2xl bg-[var(--vector-surface-active)] px-4 py-3 text-[15px] leading-[1.45] text-[var(--vector-text)]"
            >
              <markdown-block .content=${message.content}></markdown-block>
            </div>
          `}
    </div>
  `
}

const renderTerminalDock = (): TemplateResult => {
  const activeTerminalId = state.activeTerminalId

  return html`
    <div
      class=${[
        'terminal-dock relative w-full shrink-0 self-stretch flex-col overflow-hidden border-t border-[var(--vector-border)] bg-[var(--vector-bg)] transition-[opacity] duration-200',
        state.terminalDockOpen ? 'flex opacity-100' : 'hidden h-0 opacity-0'
      ].join(' ')}
      style=${state.terminalDockOpen ? `height: ${state.terminalHeight}px;` : ''}
    >
      <div
        class="group absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize transition-colors hover:bg-white/10"
        @mousedown=${onTerminalResizeStart}
      ></div>
      <div class="flex items-center justify-between gap-3 bg-[var(--vector-bg)] pr-3">
        <div class="flex min-w-0 items-end overflow-x-auto">
          ${repeat(
            state.terminalSessions,
            (terminal) => terminal.id,
            (terminal) => {
              const isActive = terminal.id === activeTerminalId

              return html`
                <div
                  class=${[
                    'flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm transition-colors border-r border-[var(--vector-border)]',
                    isActive
                      ? 'bg-[var(--vector-surface)] text-[var(--vector-text)]'
                      : 'bg-transparent text-[var(--vector-text-muted)] hover:bg-[var(--vector-surface-hover)] border-b border-[var(--vector-border)]'
                  ].join(' ')}
                >
                  <button
                    type="button"
                    class="min-w-0 truncate"
                    @click=${() => setActiveTerminal(terminal.id)}
                  >
                    ${terminal.title} ${terminal.status === 'exited' ? ' (done)' : ''}
                  </button>
                  <button
                    type="button"
                    class="text-[var(--vector-text-muted)] transition-colors hover:text-[var(--vector-error)]"
                    title="Close terminal"
                    @click=${() => void closeTerminal(terminal.id)}
                  >
                    ${icon(Trash2, 'xs')}
                  </button>
                </div>
              `
            }
          )}
          <button
            type="button"
            class="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--vector-text-muted)] transition-colors hover:bg-[var(--vector-surface-hover)] hover:text-[var(--vector-text)]"
            title="New Terminal"
            @click=${() => void createTerminal()}
          >
            <span class="text-lg leading-none">+</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 bg-[var(--vector-bg)]">
        ${state.terminalSessions.length === 0
          ? html`
              <div
                class="flex h-full items-center justify-center text-sm text-[var(--vector-text-muted)]"
              >
                Open a terminal with Cmd/Ctrl + J
              </div>
            `
          : repeat(
              state.terminalSessions,
              (terminal) => terminal.id,
              (terminal) => {
                const isActive = terminal.id === activeTerminalId
                return html`
                  <div
                    class=${[
                      'h-full w-full overflow-hidden',
                      isActive && state.terminalDockOpen ? 'block' : 'hidden'
                    ].join(' ')}
                    ${ref((element?: Element | null) => {
                      if (element instanceof HTMLDivElement) {
                        ensureTerminalInstance(terminal.id, element)
                      }
                    })}
                  ></div>
                `
              }
            )}
      </div>
    </div>
  `
}

export const App = (): TemplateResult => {
  if (!state.authChecked) {
    return html`
      <div
        class="flex min-h-screen items-center justify-center bg-[var(--vector-bg)] px-6 text-[var(--vector-text)]"
      >
        <div class="flex items-center gap-3 text-sm text-[var(--vector-text-muted)]">
          ${icon(LoaderCircle, 'sm', 'animate-spin')}
          <span>Loading Pi models…</span>
        </div>
      </div>
    `
  }

  const activeWorkspace = getActiveWorkspace()
  const activeChat = getActiveChat()
  const hasWorkspace = activeWorkspace.path !== DEFAULT_WORKSPACE_PATH
  const isSending = activeChat ? isChatRunning(activeChat.id) : false
  const rightControlsStyle = state.reviewSidebarOpen
    ? `right: ${REVIEW_SIDEBAR_WIDTH + 12}px;`
    : 'right: 10px;'

  return html`
    <div class="relative flex h-screen bg-[var(--vector-bg)] text-[var(--vector-text)]">
      <button
        type="button"
        class="absolute top-4 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vector-text)] transition-all hover:bg-[var(--vector-surface-hover)] z-10"
        style=${state.sidebarCollapsed ? 'left: 10px;' : 'left: 262px;'}
        aria-label=${state.sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
        @click=${toggleSidebar}
      >
        ${icon(state.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose, 'sm')}
      </button>

      <div
        class="absolute top-4 z-10 flex items-center gap-2 transition-all"
        style=${rightControlsStyle}
      >
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vector-text)] transition-all hover:bg-[var(--vector-surface-hover)]"
          aria-label="Toggle terminal"
          title="Toggle terminal"
          @click=${() => void toggleTerminalDock()}
        >
          ${icon(TerminalSquare, 'sm')}
        </button>

        <button
          type="button"
          class=${[
            'group flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-[var(--vector-text)] transition-all hover:bg-[var(--vector-surface-hover)]',
            state.reviewSidebarOpen ? 'bg-[var(--vector-surface-active)]' : ''
          ].join(' ')}
          aria-label="Toggle review sidebar"
          title="Toggle review sidebar (Cmd/Ctrl + Alt + B)"
          @click=${toggleReviewSidebar}
        >
          ${icon(Diff, 'sm')}
          ${
            state.reviewFiles.length > 0
              ? html`
                  <div class="flex items-center gap-1.5 text-[11px] font-bold">
                    <span class="text-[var(--vector-diff-add)]">
                      +${state.reviewFiles.reduce((acc, f) => acc + f.added, 0)}
                    </span>
                    <span class="text-[var(--vector-diff-delete)]">
                      -${state.reviewFiles.reduce((acc, f) => acc + f.removed, 0)}
                    </span>
                  </div>
                `
              : ''
          }
        </button>
      </div>

      ${renderSidebar(activeWorkspace, activeChat?.id ?? '')}

      <div class="flex min-w-0 flex-1">
        <main class="flex min-w-0 flex-1 bg-[var(--vector-bg)] pb-0 pt-6 ${state.sidebarCollapsed ? '' : 'rounded-tl-2xl'}">
          <div class="flex h-full w-full min-h-0 flex-col overflow-hidden">
            <section class="flex min-h-0 flex-1 flex-col px-6">
              <div class="flex min-h-0 flex-1 overflow-hidden">
                <div
                  class="mx-auto w-full max-w-[760px] overflow-y-auto px-1"
                  ${scrollToBottom()}
                  ${ref((element?: Element | null) => {
                    chatScrollContainer = element instanceof HTMLDivElement ? element : null
                  })}
                >
                  <div class="space-y-[18px] pt-16">
                    ${
                      activeChat
                        ? activeChat.messages.map((message) => renderMessage(message))
                        : renderNoWorkspaceState()
                    }
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 justify-center pb-1.5 pt-1.5">
                <div
                  class="relative w-full max-w-[760px] rounded-[24px] border border-[var(--vector-border)] bg-[var(--vector-surface)] shadow-xl shadow-black/20 px-[18px] pb-3 pt-2.5"
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    class="hidden"
                    ${ref((element?: Element | null) => {
                      composerFileInput = element instanceof HTMLInputElement ? element : null
                    })}
                    @change=${(event: Event) => {
                      const target = event.target as HTMLInputElement
                      void handleComposerImageFiles(target.files)
                      target.value = ''
                    }}
                  />

                  ${
                    state.composerImages.length > 0
                      ? html`<div class="mb-2 flex flex-wrap gap-2">
                          ${repeat(
                            state.composerImages,
                            (image) => image.id,
                            (image) => html`
                              <div
                                class="flex h-14 items-center gap-2 rounded-lg border border-[var(--vector-border-strong)] bg-[var(--vector-surface-raised)] px-2"
                              >
                                <img
                                  src=${image.previewUrl}
                                  alt=${image.name}
                                  class="h-10 w-10 rounded-md object-cover"
                                />
                                <span
                                  class="max-w-[180px] truncate text-xs text-[var(--vector-text)]"
                                  >${image.name}</span
                                >
                                <button
                                  type="button"
                                  class="rounded p-1 text-[var(--vector-text-muted)] hover:bg-[var(--vector-surface-hover)] hover:text-[var(--vector-text)]"
                                  aria-label="Remove image"
                                  @click=${() => removeComposerImage(image.id)}
                                >
                                  ${icon(X, 'sm')}
                                </button>
                              </div>
                            `
                          )}
                        </div>`
                      : ''
                  }

                  <textarea
                    class="min-h-[40px] max-h-[168px] w-full resize-none overflow-y-hidden bg-transparent pb-0 text-base font-medium leading-6 text-[var(--vector-text)] outline-none placeholder:text-[var(--vector-text-muted)] disabled:cursor-not-allowed disabled:opacity-70"
                    style="scrollbar-gutter: stable;"
                    placeholder=${hasWorkspace ? 'Build anything' : 'Open a folder to start'}
                    .value=${state.composer}
                    ?disabled=${!activeChat}
                    ${ref((element?: Element | null) => {
                      composerTextarea = element instanceof HTMLTextAreaElement ? element : null
                      queueMicrotask(syncComposerHeight)
                    })}
                    @input=${(event: Event) => {
                      setComposer((event.target as HTMLTextAreaElement).value)
                    }}
                  ></textarea>

                  <div class="mt-1 flex items-center justify-between gap-3 pt-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        class="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vector-text)] transition-all hover:bg-[var(--vector-surface-hover)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Attach images"
                        title="Attach images"
                        ?disabled=${!activeChat || isSending}
                        @click=${openComposerImagePicker}
                      >
                        ${icon(ImagePlus, 'sm')}
                      </button>

                      ${Select({
                        className: 'model-select-btn',
                        variant: 'ghost',
                        value: state.selectedModelId,
                        placeholder: 'Model',
                        options: state.models.map((model) => ({
                          value: model.id,
                          label: model.name
                        })),
                        onChange: (value) => {
                          setSelectedModelId(value)
                        },
                        disabled: !activeChat || state.models.length === 0 || isSending,
                        width: 'auto',
                        size: 'md'
                      })}

                      ${Select({
                        className: 'thinking-select-btn',
                        variant: 'ghost',
                        value: state.selectedThinkingLevel,
                        placeholder: 'Thinking',
                        options: getAvailableThinkingLevels().map((level) => ({
                          value: level,
                          label: THINKING_LEVEL_LABELS[level]
                        })),
                        onChange: (value) => {
                          setSelectedThinkingLevel(value as ThinkingLevel)
                        },
                        disabled: !activeChat || isSending,
                        width: 'auto',
                        size: 'md'
                      })}
                    </div>

                    <button
                      type="button"
                      class="shrink-0 flex h-11 w-11 items-center justify-center bg-transparent text-white disabled:cursor-not-allowed disabled:opacity-50"
                      title=${
                        isSending
                          ? 'Assistant responding. This becomes a stop control.'
                          : 'Send message'
                      }
                      ?disabled=${
                        (!(state.composer.trim() || state.composerImages.length > 0) ||
                          !activeChat ||
                          state.models.length === 0) &&
                        !isSending
                      }
                      @click=${() => void sendMessage()}
                    >
                    ${
                      isSending
                        ? html`
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="32"
                              height="32"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4 14H8V8h8v8z"
                              />
                            </svg>
                          `
                        : html`
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="32"
                              height="32"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                d="M17 3.34a10 10 0 1 1-14.995 8.984L2 12l.005-.324A10 10 0 0 1 17 3.34M12.02 7l-.163.01l-.086.016l-.142.045l-.113.054l-.07.043l-.095.071l-.058.054l-4 4l-.083.094a1 1 0 0 0 1.497 1.32L11 10.414V16l.007.117A1 1 0 0 0 13 16v-5.585l2.293 2.292l.094.083a1 1 0 0 0 1.32-1.497l-4-4l-.082-.073l-.089-.064l-.113-.062l-.081-.034l-.113-.034l-.112-.02z"
                              />
                            </svg>
                          `
                    }
                  </button>
                </div>
              </div>
            </section>

            ${renderTerminalDock()}
          </div>
        </main>

        ${renderReviewSidebar(activeWorkspace)}
      </div>

      ${Dialog({
        isOpen: state.settingsDialogOpen,
        onClose: closeSettingsDialog,
        width: '400px',
        children: html`
          ${DialogContent({
            children: html`
              ${DialogHeader({
                title: 'Settings',
                description: 'Vector uses your Pi CLI auth and model configuration.'
              })}
              ${DialogFooter({
                children: html`
                  <div class="mt-5 flex justify-end gap-2">
                    ${Button({
                      variant: 'outline',
                      onClick: () => closeSettingsDialog(),
                      children: 'Close'
                    })}
                  </div>
                `
              })}
            `
          })}
        `
      })}

      ${Dialog({
        isOpen: Boolean(state.deleteChatId),
        onClose: closeDeleteChatDialog,
        width: '400px',
        children: html`
          ${DialogContent({
            children: html`
              ${DialogHeader({
                title: 'Delete chat?',
                description: 'This will permanently remove the chat from the sidebar.'
              })}

              <div
                class="mt-4 flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--vector-error)_12%,transparent)] p-3 text-sm text-[var(--vector-error)]"
              >
                ${icon(AlertTriangle, 'sm', 'text-[var(--vector-error)]')}
                <span>This action cannot be undone.</span>
              </div>

              ${DialogFooter({
                children: html`
                  <div class="mt-5 flex justify-end gap-2">
                    ${Button({
                      variant: 'outline',
                      onClick: () => closeDeleteChatDialog(),
                      children: 'Cancel'
                    })}
                    ${Button({
                      variant: 'destructive',
                      onClick: () => confirmDeleteChat(),
                      children: 'Delete'
                    })}
                  </div>
                `
              })}
            `
          })}
        `
      })}

    </div>
  `
}

window.addEventListener('keydown', onGlobalKeyDown)
window.addEventListener('resize', scheduleTerminalFit)
window.addEventListener('beforeunload', () => {
  revokeComposerImagePreviews(state.composerImages)
})
void syncTerminalSessions()
void syncAuthState()
