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
import { Checkbox } from '@mariozechner/mini-lit/dist/Checkbox.js'
import { Select } from '@mariozechner/mini-lit/dist/Select.js'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from '@mariozechner/mini-lit/dist/Dialog.js'
import { Button } from '@mariozechner/mini-lit/dist/Button.js'
import { Input } from '@mariozechner/mini-lit/dist/Input.js'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Diff,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  SquarePen,
  TerminalSquare,
  Trash2
} from 'lucide'

type Role = 'user' | 'assistant'

type ModelOption = {
  id: string
  name: string
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

const THINKING_LEVELS: Array<{ id: ThinkingLevel; label: string }> = [
  { id: 'off', label: 'off' },
  { id: 'minimal', label: 'minimal' },
  { id: 'low', label: 'low' },
  { id: 'medium', label: 'medium' },
  { id: 'high', label: 'high' },
  { id: 'xhigh', label: 'xhigh' }
]

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

type QuestionDraft = {
  selectedOption: string
  customAnswer: string
}

type QuestionPromptState = {
  chatId: string
  toolCallId: string
  questions: QuestionPromptQuestion[]
  drafts: Record<string, QuestionDraft>
  currentIndex: number
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
  chatRunStateByChatId: Record<string, ChatRunState>
  authChecked: boolean
  loggedIn: boolean
  authBusy: boolean
  authError: string | null
  models: ModelOption[]
  sidebarCollapsed: boolean
  expandedWorkspaces: Set<string>
  settingsDialogOpen: boolean
  deleteChatId: string | null
  terminalDockOpen: boolean
  terminalSessions: TerminalSessionSummary[]
  activeTerminalId: string
  reviewSidebarOpen: boolean
  reviewFiles: ReviewFile[]
  expandedReviewFiles: Set<string>
  reviewLoading: boolean
  reviewError: string | null
  reviewLastLoadedWorkspacePath: string
  activeQuestionPrompt: QuestionPromptState | null
}

const STORAGE_KEY = 'pi-ui.chats.v5'
const DEFAULT_WORKSPACE_PATH = '__no-folder__'
const REVIEW_SIDEBAR_WIDTH = 720
const REVIEW_REFRESH_DEBOUNCE_MS = 180
const REVIEW_DIFF_CONTEXT_LINES = 3

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
    const raw = localStorage.getItem(STORAGE_KEY)
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
        selectedModelId: parsed.selectedModelId ?? 'gpt-5.4',
        selectedThinkingLevel: parsed.selectedThinkingLevel ?? 'medium',
        composer: '',
        chatRunStateByChatId: {},
        authChecked: false,
        loggedIn: false,
        authBusy: false,
        authError: null,
        models: [],
        sidebarCollapsed: true,
        expandedWorkspaces: new Set<string>(),
        settingsDialogOpen: false,
        deleteChatId: null,
        terminalDockOpen: false,
        terminalSessions: [],
        activeTerminalId: '',
        reviewSidebarOpen: false,
        reviewFiles: [],
        expandedReviewFiles: new Set<string>(),
        reviewLoading: false,
        reviewError: null,
        reviewLastLoadedWorkspacePath: '',
        activeQuestionPrompt: null
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
    selectedModelId: 'gpt-5.4',
    selectedThinkingLevel: 'medium',
    composer: '',
    chatRunStateByChatId: {},
    authChecked: false,
    loggedIn: false,
    authBusy: false,
    authError: null,
    models: [],
    sidebarCollapsed: true,
    expandedWorkspaces: new Set<string>(),
    settingsDialogOpen: false,
    deleteChatId: null,
    terminalDockOpen: false,
    terminalSessions: [],
    activeTerminalId: '',
    reviewSidebarOpen: false,
    reviewFiles: [],
    expandedReviewFiles: new Set<string>(),
    reviewLoading: false,
    reviewError: null,
    reviewLastLoadedWorkspacePath: '',
    activeQuestionPrompt: null
  }
}

let state = loadState()
let notifyChange: (() => void) | undefined
let folderPickerInFlight = false
let unsubscribeStream: (() => void) | undefined
let unsubscribeTerminal: (() => void) | undefined
let unsubscribeChatNotificationClick: (() => void) | undefined
let unsubscribeQuestionPrompt: (() => void) | undefined
let composerTextarea: HTMLTextAreaElement | null = null
let chatScrollContainer: HTMLDivElement | null = null
const terminalInstances = new Map<string, { terminal: XTerm; fitAddon: FitAddon }>()
const terminalMounts = new Map<string, HTMLDivElement>()
const pendingTerminalOutput = new Map<string, string[]>()
let terminalResizeTick: number | null = null
let reviewRefreshTick: number | null = null
let reviewRefreshRequestId = 0

const syncComposerHeight = (): void => {
  if (!composerTextarea) return

  const minHeight = 74
  const maxHeight = 210
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

const scrollActiveChatToBottom = (): void => {
  queueMicrotask(() => {
    if (!chatScrollContainer) return
    chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight
  })
}

const getChatRunState = (current: AppState, chatId: string): ChatRunState | undefined => {
  return current.chatRunStateByChatId[chatId]
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
        background: '#000000',
        foreground: '#f5f5f5',
        cursor: '#f5f5f5',
        cursorAccent: '#000000',
        selectionBackground: '#505050',
        black: '#1f1f1f',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#f2cc60',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#a5f3fc',
        white: '#c9d1d9',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#bc8cff',
        brightCyan: '#39c5cf',
        brightWhite: '#f0f6fc'
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

export const setQuestionPromptCleanup = (
  subscribe: (listener: (event: QuestionPromptEvent) => void) => () => void
): void => {
  unsubscribeQuestionPrompt?.()
  unsubscribeQuestionPrompt = subscribe((event) => {
    updateState((current) => ({
      ...current,
      activeQuestionPrompt: {
        chatId: event.chatId,
        toolCallId: event.toolCallId,
        questions: event.questions,
        currentIndex: 0,
        drafts: Object.fromEntries(
          event.questions.map((question) => [
            question.topic,
            { selectedOption: '', customAnswer: '' } satisfies QuestionDraft
          ])
        )
      }
    }))
  })
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
        const chat = getChatById(event.chatId, nextState)

        if (hasUnreadCompletion && chat) {
          notification = {
            chatId: event.chatId,
            title: chat.title,
            body: 'Response finished'
          }
        }

        return {
          ...nextState,
          chats: sortChats(
            nextState.chats.map((chat) =>
              chat.id === event.chatId
                ? {
                    ...chat,
                    updatedAt: now()
                  }
                : chat
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
        const chat = getChatById(event.chatId, nextState)

        if (hasUnreadCompletion && chat) {
          notification = {
            chatId: event.chatId,
            title: chat.title,
            body: 'Response ended with an error'
          }
        }

        return {
          ...nextState,
          chats: sortChats(
            nextState.chats.map((chat) =>
              chat.id === event.chatId
                ? {
                    ...chat,
                    updatedAt: now()
                  }
                : chat
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

const updateQuestionDraft = (
  topic: string,
  updater: (draft: QuestionDraft) => QuestionDraft
): void => {
  updateState((current) => {
    if (!current.activeQuestionPrompt) return current

    return {
      ...current,
      activeQuestionPrompt: {
        ...current.activeQuestionPrompt,
        drafts: {
          ...current.activeQuestionPrompt.drafts,
          [topic]: updater(
            current.activeQuestionPrompt.drafts[topic] ?? { selectedOption: '', customAnswer: '' }
          )
        }
      }
    }
  })
}

const setQuestionPromptPage = (nextIndex: number): void => {
  updateState((current) => {
    if (!current.activeQuestionPrompt) return current

    const maxIndex = Math.max(0, current.activeQuestionPrompt.questions.length - 1)
    return {
      ...current,
      activeQuestionPrompt: {
        ...current.activeQuestionPrompt,
        currentIndex: Math.min(maxIndex, Math.max(0, nextIndex))
      }
    }
  })
}

const closeQuestionPrompt = async (cancelled: boolean): Promise<void> => {
  const prompt = state.activeQuestionPrompt
  if (!prompt) return

  if (cancelled) {
    await window.api.submitQuestionResponse({ toolCallId: prompt.toolCallId, cancelled: true })
    updateState((current) => ({ ...current, activeQuestionPrompt: null }))
    return
  }

  const answers = prompt.questions.map((question) => {
    const draft = prompt.drafts[question.topic] ?? { selectedOption: '', customAnswer: '' }
    const answer = draft.customAnswer.trim() || draft.selectedOption.trim()
    return {
      topic: question.topic,
      question: question.question,
      answer
    }
  })

  if (answers.some((answer) => !answer.answer)) {
    return
  }

  await window.api.submitQuestionResponse({
    toolCallId: prompt.toolCallId,
    answers
  })

  updateState((current) => ({ ...current, activeQuestionPrompt: null }))
}

const renderInlineQuestionPrompt = (prompt: QuestionPromptState): TemplateResult => {
  const question = prompt.questions[prompt.currentIndex]
  const draft = prompt.drafts[question.topic] ?? {
    selectedOption: '',
    customAnswer: ''
  }
  const isFirst = prompt.currentIndex === 0
  const isLast = prompt.currentIndex === prompt.questions.length - 1

  return html`
    <section class="mb-3 rounded-2xl border border-white/10 bg-[#242424] p-4">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <div class="text-[11px] font-medium uppercase tracking-[0.2em] text-[#8f8f8f]">
            Question
          </div>
          <div class="mt-1 text-sm text-[#d7d7d7]">
            Vector needs a few quick answers before continuing.
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[#cfcfcf] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            ?disabled=${isFirst}
            @click=${() => setQuestionPromptPage(prompt.currentIndex - 1)}
          >
            ${icon(ChevronLeft, 'sm')}
          </button>
          <div class="min-w-[44px] text-center text-xs font-medium text-[#a9a9a9]">
            ${prompt.currentIndex + 1}/${prompt.questions.length}
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[#cfcfcf] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            ?disabled=${isLast}
            @click=${() => setQuestionPromptPage(prompt.currentIndex + 1)}
          >
            ${icon(ChevronRight, 'sm')}
          </button>
        </div>
      </div>

      <section class="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        <div class="mb-3">
          <div class="text-xs font-medium uppercase tracking-[0.18em] text-[#8f8f8f]">
            ${question.topic}
          </div>
          <div class="mt-1 text-sm font-medium text-white">
            ${question.index}. ${question.question}
          </div>
        </div>

        <div class="flex flex-col gap-2">
          ${question.options.map((option) =>
            Checkbox({
              checked: draft.selectedOption === option && draft.customAnswer.trim() === '',
              label: option,
              onChange: (checked) => {
                updateQuestionDraft(question.topic, (currentDraft) => ({
                  ...currentDraft,
                  selectedOption: checked ? option : '',
                  customAnswer: checked ? '' : currentDraft.customAnswer
                }))
              },
              className:
                'rounded-md border border-white/8 bg-black/10 px-3 py-2 text-sm text-white'
            })
          )}
        </div>

        <div class="mt-3">
          ${Input({
            value: draft.customAnswer,
            placeholder: 'Own answer',
            className: 'w-full',
            onInput: (event) => {
              const nextValue = (event.target as HTMLInputElement).value
              updateQuestionDraft(question.topic, (currentDraft) => ({
                ...currentDraft,
                selectedOption: nextValue.trim() ? '' : currentDraft.selectedOption,
                customAnswer: nextValue
              }))
            }
          })}
        </div>
      </section>

      <div class="mt-4 flex justify-end gap-2">
        ${Button({
          variant: 'outline',
          onClick: () => void closeQuestionPrompt(true),
          children: 'Cancel'
        })}
        ${Button({
          variant: 'outline',
          onClick: () => setQuestionPromptPage(prompt.currentIndex - 1),
          disabled: isFirst,
          children: 'Back'
        })}
        ${Button({
          variant: 'outline',
          onClick: () => setQuestionPromptPage(prompt.currentIndex + 1),
          disabled: isLast,
          children: 'Next'
        })}
        ${Button({
          onClick: () => void closeQuestionPrompt(false),
          disabled: prompt.questions.some((question) => {
            const draft = prompt.drafts[question.topic] ?? {
              selectedOption: '',
              customAnswer: ''
            }
            return !draft.selectedOption.trim() && !draft.customAnswer.trim()
          }),
          children: 'Continue'
        })}
      </div>
    </section>
  `
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
  updateState((current) => ({
    ...current,
    authChecked: true,
    loggedIn: authState.loggedIn,
    models: authState.models,
    selectedModelId: authState.models.some((model) => model.id === current.selectedModelId)
      ? current.selectedModelId
      : authState.defaultModelId,
    authError: null
  }))
}

const loginCodex = async (): Promise<void> => {
  updateState((current) => ({
    ...current,
    authBusy: true,
    authError: null
  }))

  const result = await window.api.loginCodex()
  if (!result.ok) {
    updateState((current) => ({
      ...current,
      authBusy: false,
      authChecked: true,
      loggedIn: false,
      authError: result.error
    }))
    return
  }

  updateState((current) => ({
    ...current,
    authBusy: false,
    authChecked: true,
    loggedIn: result.state.loggedIn,
    models: result.state.models,
    selectedModelId: result.state.models.some((model) => model.id === current.selectedModelId)
      ? current.selectedModelId
      : result.state.defaultModelId,
    authError: null
  }))
}

const setComposer = (value: string): void => {
  state = {
    ...state,
    composer: value
  }
  triggerChange()
  queueMicrotask(syncComposerHeight)
}

const setSelectedModelId = (value: string): void => {
  updateState((current) => ({
    ...current,
    selectedModelId: value
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
  updateState((current) => ({
    ...current,
    activeWorkspacePath: workspace.path,
    activeChatId: chat.id,
    chats: sortChats([chat, ...current.chats]),
    composer: ''
  }))
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

const logoutCodex = async (): Promise<void> => {
  if (state.authBusy) return

  updateState((current) => ({
    ...current,
    authBusy: true,
    authError: null
  }))

  const result = await window.api.logoutCodex()
  if (!result.ok) {
    updateState((current) => ({
      ...current,
      authBusy: false,
      authChecked: true,
      authError: result.error
    }))
    return
  }

  updateState((current) => ({
    ...current,
    authBusy: false,
    authChecked: true,
    loggedIn: result.state.loggedIn,
    models: result.state.models,
    selectedModelId: result.state.models.some((model) => model.id === current.selectedModelId)
      ? current.selectedModelId
      : result.state.defaultModelId,
    authError: null,
    settingsDialogOpen: false
  }))
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

      return clearChatCompletionState(
        {
          ...current,
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

  if (
    !content ||
    !activeChat ||
    workspace.path === DEFAULT_WORKSPACE_PATH ||
    isChatRunning(activeChat.id) ||
    !state.loggedIn
  ) {
    return
  }

  const userMessage: Message = {
    id: createId(),
    role: 'user',
    content,
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
          title: chat.messages.length <= 1 ? getChatTitleFromInput(content) : chat.title,
          messages: [...chat.messages, userMessage, assistantMessage],
          updatedAt: userMessage.createdAt
        }
      })
    ),
    composer: '',
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

  const result = await window.api.sendChatMessage({
    chatId: activeChat.id,
    cwd: workspace.path,
    prompt: content,
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
  }
}

const renderOpenAiMark = (className = 'h-4 w-4'): TemplateResult => html`
  <svg class=${className} viewBox="0 0 256 260" fill="none" aria-hidden="true">
    <path
      d="M239.184 106.203a64.72 64.72 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.72 64.72 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.67 64.67 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.77 64.77 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483m-97.56 136.338a48.4 48.4 0 0 1-31.105-11.255l1.535-.87l51.67-29.825a8.6 8.6 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601M37.158 197.93a48.35 48.35 0 0 1-5.781-32.589l1.534.921l51.722 29.826a8.34 8.34 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803M23.549 85.38a48.5 48.5 0 0 1 25.58-21.333v61.39a8.29 8.29 0 0 0 4.195 7.316l62.874 36.272l-21.845 12.636a.82.82 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405m179.466 41.695l-63.08-36.63L161.73 77.86a.82.82 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.54 8.54 0 0 0-4.4-7.213m21.742-32.69l-1.535-.922l-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.72.72 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391zM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87l-51.67 29.825a8.6 8.6 0 0 0-4.246 7.367zm11.868-25.58L128.067 97.3l28.188 16.218v32.434l-28.086 16.218l-28.188-16.218z"
      stroke="currentColor"
      stroke-width="10"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`

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
        ? icon(LoaderCircle, 'xs', 'h-3.5 w-3.5 animate-spin text-[#8ab4ff]')
        : showCompleted
          ? html`<span class="h-1.5 w-1.5 rounded-full bg-[#4da3ff]"></span>`
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
                isActive ? 'bg-[#434343]' : 'bg-transparent hover:bg-[#434343]'
              ].join(' ')}
              @click=${() => selectChat(chat.id)}
            >
              <span class="flex min-w-0 items-center gap-2">
                ${renderChatStatusIndicator(chat.id, isActive)}
                <span class="min-w-0 truncate text-[13px] font-medium leading-none text-[#f5f5f5]">
                  ${chat.title}
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                ${canDelete
                  ? html`
                      <button
                        type="button"
                        class="flex h-5 w-5 items-center justify-center text-[#8f8f8f] opacity-0 transition-all group-hover:opacity-100 hover:text-[#f28b82]"
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
                <span class="text-[13px] leading-none text-[#b3b3b3]">
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
              class="flex h-full w-[252px] min-w-[252px] flex-col border-r border-[#4a4a4a] bg-[#2f2f2f] px-1 py-3"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#f5f5f5] transition-colors hover:bg-[#434343]"
                ?disabled=${activeWorkspace.path === DEFAULT_WORKSPACE_PATH}
                @click=${() => createNewChat()}
              >
                ${icon(SquarePen, 'sm')}
                <span class="text-[15px] font-medium leading-none">New Thread</span>
              </button>

              <div class="mt-2 flex items-center justify-between px-3 pb-1 pt-2">
                <span class="text-[13px] font-medium leading-none text-[#8f8f8f]">Threads</span>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-[#f5f5f5] transition-colors hover:bg-[#434343]"
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
                        <p class="px-3 pt-3 text-[13px] leading-5 text-[#8f8f8f]">
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
                                  'shrink-0 text-[#f5f5f5]'
                                )}
                                <span
                                  class="truncate text-[15px] font-semibold leading-none text-[#f5f5f5]"
                                >
                                  ${workspace.name}
                                </span>
                              </button>

                              <button
                                type="button"
                                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#8f8f8f] transition-colors hover:bg-[#434343] hover:text-[#f5f5f5]"
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

              <div class="mt-3 px-2 pt-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#f5f5f5] transition-colors hover:bg-[#434343] disabled:cursor-not-allowed disabled:opacity-60"
                  ?disabled=${state.authBusy}
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
            <div class="border-y border-[#333333] bg-[#292929] px-4 py-1.5 text-center text-[11px] text-[#858585]">
              ${row.text}
            </div>
          `
        }

        const rowTone =
          row.kind === 'add'
            ? 'bg-[#0f2a18]'
            : row.kind === 'remove'
              ? 'bg-[#321a1a]'
              : 'bg-transparent'

        return html`
          <div
            class=${[
              'grid grid-cols-[56px_56px_minmax(0,1fr)] items-start gap-0 border-b border-[#2f2f2f] text-[12px] leading-5',
              rowTone
            ].join(' ')}
          >
            <div class="select-none px-3 py-1 text-right font-mono text-[#666666]">
              ${formatReviewLineNumber(row.leftLineNumber)}
            </div>
            <div class="select-none px-3 py-1 text-right font-mono text-[#666666]">
              ${formatReviewLineNumber(row.rightLineNumber)}
            </div>
            <pre class="m-0 overflow-x-auto px-3 py-1 font-mono text-[#e6e6e6]">${row.kind === 'add'
              ? '+'
              : row.kind === 'remove'
                ? '-'
                : ' '}${row.text}</pre>
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
      class="flex h-full shrink-0 flex-col border-l border-[#4a4a4a] bg-[#262626]"
      style=${`width: ${REVIEW_SIDEBAR_WIDTH}px; min-width: ${REVIEW_SIDEBAR_WIDTH}px;`}
    >
      <div class="flex items-start justify-between gap-3 border-b border-[#3b3b3b] px-4 pb-3 pt-4">
        <div class="min-w-0">
          <div class="text-[#f5f5f5]">
            <span class="text-[15px] font-semibold">Review changes</span>
          </div>
          <p class="mt-1 text-[12px] leading-5 text-[#9a9a9a]">
            ${hasWorkspace
              ? `${state.reviewFiles.length} file${state.reviewFiles.length === 1 ? '' : 's'} in ${activeWorkspace.name}`
              : 'Open a workspace to review changes'}
          </p>
        </div>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-[#b8b8b8] transition-colors hover:bg-[#343434] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
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
              <div class="rounded-2xl border border-dashed border-[#404040] px-4 py-5 text-sm text-[#9a9a9a]">
                Open a git workspace to review changes inside the app.
              </div>
            `
          : state.reviewError
            ? html`
                <div class="rounded-2xl border border-[#553636] bg-[#321f1f] px-4 py-5 text-sm text-[#f2b8b5]">
                  ${state.reviewError}
                </div>
              `
            : state.reviewLoading && !hasFiles
              ? html`
                  <div class="flex items-center gap-3 rounded-2xl border border-[#3b3b3b] px-4 py-5 text-sm text-[#9a9a9a]">
                    ${icon(LoaderCircle, 'sm', 'animate-spin')}
                    <span>Loading workspace diff…</span>
                  </div>
                `
              : !hasFiles
                ? html`
                    <div class="rounded-2xl border border-dashed border-[#404040] px-4 py-5 text-sm text-[#9a9a9a]">
                      No uncommitted file changes in this workspace.
                    </div>
                  `
                : html`
                    <div class="overflow-hidden rounded-2xl border border-[#3b3b3b] bg-[#2d2d2d]">
                      ${repeat(
                        state.reviewFiles,
                        (reviewFile) => reviewFile.path,
                        (reviewFile, index) => {
                          const isExpanded = state.expandedReviewFiles.has(reviewFile.path)

                          return html`
                            <section class=${index > 0 ? 'border-t border-[#3b3b3b]' : ''}>
                              <button
                                type="button"
                                class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#343434]"
                                @click=${() => toggleReviewFileExpanded(reviewFile.path)}
                              >
                                <div class="flex min-w-0 items-center gap-3">
                                  <div class="truncate text-[13px] font-semibold text-[#f5f5f5]">
                                    ${reviewFile.path}
                                  </div>
                                  <div class="flex shrink-0 items-center gap-2 text-[11px] text-[#9a9a9a]">
                                    <span class="text-[#73d07f]">+${reviewFile.added}</span>
                                    <span class="text-[#ef8e8e]">-${reviewFile.removed}</span>
                                  </div>
                                </div>

                                <span
                                  class=${[
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#383838] text-[#b8b8b8] transition-transform',
                                    isExpanded ? 'rotate-180' : ''
                                  ].join(' ')}
                                >
                                  ${renderReviewChevron()}
                                </span>
                              </button>

                              ${isExpanded
                                ? html`
                                    <div class="border-t border-[#3b3b3b] px-3 py-3">
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
        <div class="text-2xl font-semibold text-[#f5f5f5]">Open a workspace to start</div>
        <p class="text-sm leading-6 text-[#8f8f8f]">
          Use the folder-plus action or press Cmd/Ctrl + O. Only the conversation area scrolls.
        </p>
      </div>
    </div>
  `
}

const renderToolInvocation = (tool: ToolInvocation): TemplateResult => {
  const statusTone = tool.status === 'error' ? 'text-[#f28b82]' : 'text-[#8f8f8f]'
  const statusLabel = tool.status === 'error' ? 'error' : tool.status === 'running' ? 'running' : ''

  return html`
    <details class="overflow-hidden" ?open=${false}>
      <summary
        class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[#8f8f8f]"
      >
        <span class="text-[13px] font-medium text-[#f5f5f5]">${tool.name}</span>
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
              class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[#2d2d2d] px-3 py-2 text-xs leading-5 text-[#bdbdbd]"
            >
${tool.argsText}</pre
            >`
          : ''}
        ${tool.output
          ? html`<pre
              class="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[#2a2a2a] px-3 py-2 text-xs leading-5 text-[#d8d8d8]"
            >
${tool.output}</pre
            >`
          : tool.status === 'running'
            ? html`<div class="mt-3 text-xs text-[#8f8f8f]">Waiting for output…</div>`
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
            <div class="max-w-[640px] space-y-3 text-[15px] leading-[1.55] text-[#f5f5f5]">
              ${hasThinking
                ? html`
                    <details class="overflow-hidden" ?open=${message.streaming && !message.content}>
                      <summary
                        class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[#8f8f8f]"
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
                    <div class="mt-2 flex items-center gap-2 text-xs text-[#8f8f8f]">
                      ${icon(LoaderCircle, 'xs', 'animate-spin')}
                      <span>Responding</span>
                    </div>
                  `
                : ''}
            </div>
          `
        : html`
            <div
              class="max-w-[360px] rounded-2xl bg-[#434343] px-4 py-3 text-[15px] leading-[1.45] text-[#f5f5f5]"
            >
              <markdown-block .content=${message.content}></markdown-block>
            </div>
          `}
    </div>
  `
}

const renderOnboarding = (): TemplateResult => {
  return html`
    <div class="flex min-h-screen items-center justify-center bg-[#2f2f2f] px-6 text-[#f5f5f5]">
      <div class="flex flex-col items-center gap-4">
        <button
          type="button"
          class="inline-flex items-center gap-3 rounded-full border border-[#4b5563] bg-[#3a3a3a] px-6 py-4 text-[16px] font-medium text-[#f5f5f5] transition-colors hover:bg-[#434343] disabled:cursor-not-allowed disabled:opacity-60"
          ?disabled=${state.authBusy}
          @click=${() => void loginCodex()}
        >
          ${state.authBusy
            ? html`${icon(LoaderCircle, 'sm', 'animate-spin')}`
            : html`${renderOpenAiMark('h-[18px] w-[18px]')}`}
          <span>${state.authBusy ? 'Logging in' : 'Log in with OpenAI'}</span>
        </button>

        ${state.authError
          ? html`<p class="max-w-md text-center text-sm leading-6 text-[#f28b82]">
              ${state.authError}
            </p>`
          : ''}
      </div>
    </div>
  `
}

const renderTerminalDock = (): TemplateResult => {
  const activeTerminalId = state.activeTerminalId

  return html`
    <div
      class=${[
        'terminal-dock w-full shrink-0 self-stretch flex-col overflow-hidden border-t border-[#353535] bg-[#171717] transition-all',
        state.terminalDockOpen ? 'flex h-[340px] opacity-100' : 'hidden h-0 opacity-0'
      ].join(' ')}
    >
      <div
        class="flex items-center justify-between gap-3 border-b border-[#2a2a2a] bg-[#171717] px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2 overflow-x-auto">
          ${repeat(
            state.terminalSessions,
            (terminal) => terminal.id,
            (terminal) => {
              const isActive = terminal.id === activeTerminalId

              return html`
                <div
                  class=${[
                    'flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-[#3a3a3a] text-[#f5f5f5]'
                      : 'bg-transparent text-[#b3b3b3] hover:bg-[#303030]'
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
                    class="text-[#8f8f8f] transition-colors hover:text-[#f28b82]"
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
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#b3b3b3] transition-colors hover:bg-[#303030] hover:text-[#f5f5f5]"
            title="New Terminal"
            @click=${() => void createTerminal()}
          >
            <span class="text-lg leading-none">+</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 bg-[#171717]">
        ${state.terminalSessions.length === 0
          ? html`
              <div class="flex h-full items-center justify-center text-sm text-[#8f8f8f]">
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
                    'h-full w-full overflow-hidden px-[10px] pb-[10px] pt-[8px]',
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
      <div class="flex min-h-screen items-center justify-center bg-[#2f2f2f] px-6 text-[#f5f5f5]">
        <div class="flex items-center gap-3 text-sm text-[#8f8f8f]">
          ${icon(LoaderCircle, 'sm', 'animate-spin')}
          <span>Checking login…</span>
        </div>
      </div>
    `
  }

  if (!state.loggedIn) {
    return renderOnboarding()
  }

  const activeWorkspace = getActiveWorkspace()
  const activeChat = getActiveChat()
  const activeQuestionPrompt = state.activeQuestionPrompt
  const hasWorkspace = activeWorkspace.path !== DEFAULT_WORKSPACE_PATH
  const isSending = activeChat ? isChatRunning(activeChat.id) : false
  const rightControlsStyle = state.reviewSidebarOpen
    ? `right: ${REVIEW_SIDEBAR_WIDTH + 12}px;`
    : 'right: 12px;'

  return html`
    <div class="relative flex h-screen bg-[#2f2f2f] text-[#f5f5f5]">
      <button
        type="button"
        class="absolute top-3 flex h-9 w-9 items-center justify-center rounded-lg text-[#f5f5f5] transition-all hover:bg-[#3f3f3f] z-10"
        style=${state.sidebarCollapsed ? 'left: 12px;' : 'left: 264px;'}
        aria-label=${state.sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
        @click=${toggleSidebar}
      >
        ${icon(state.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose, 'sm')}
      </button>

      <div
        class="absolute top-3 z-10 flex items-center gap-2 transition-all"
        style=${rightControlsStyle}
      >
        <button
          type="button"
          class=${[
            'flex h-9 w-9 items-center justify-center rounded-lg text-[#f5f5f5] transition-all hover:bg-[#3f3f3f]',
            state.reviewSidebarOpen ? 'bg-[#3a3a3a]' : ''
          ].join(' ')}
          aria-label="Toggle review sidebar"
          title="Toggle review sidebar (Cmd/Ctrl + Alt + B)"
          @click=${toggleReviewSidebar}
        >
          ${icon(Diff, 'sm')}
        </button>

        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg text-[#f5f5f5] transition-all hover:bg-[#3f3f3f]"
          aria-label="Toggle terminal"
          title="Toggle terminal"
          @click=${() => void toggleTerminalDock()}
        >
          ${icon(TerminalSquare, 'sm')}
        </button>
      </div>

      ${renderSidebar(activeWorkspace, activeChat?.id ?? '')}

      <div class="flex min-w-0 flex-1">
        <main class="flex min-w-0 flex-1 bg-[#2f2f2f] pb-0 pt-6">
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

              <div class="flex shrink-0 justify-center pb-1 pt-8">
                <div
                  class="relative w-full max-w-[760px] rounded-[24px] border border-[#505050] bg-[#3a3a3a] px-[18px] pb-3 pt-2.5"
                >
                  ${activeQuestionPrompt ? renderInlineQuestionPrompt(activeQuestionPrompt) : ''}

                  <textarea
                    class="min-h-[74px] max-h-[210px] w-full resize-none overflow-y-hidden bg-transparent pb-1 text-[18px] font-medium leading-7 text-[#f5f5f5] outline-none placeholder:text-[#a3a3a3] disabled:cursor-not-allowed disabled:opacity-70"
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

                  <div class="mt-1.5 flex items-center justify-between gap-3 pt-1.5">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      ${Select({
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
                        width: '220px',
                        size: 'md'
                      })}

                      ${Select({
                        variant: 'ghost',
                        value: state.selectedThinkingLevel,
                        placeholder: 'Thinking',
                        options: THINKING_LEVELS.map((level) => ({
                          value: level.id,
                          label: level.label
                        })),
                        onChange: (value) => {
                          setSelectedThinkingLevel(value as ThinkingLevel)
                        },
                        disabled: !activeChat || isSending,
                        width: '170px',
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
                      ?disabled=${(!state.composer.trim() || !activeChat) && !isSending}
                      @click=${() => void sendMessage()}
                    >
                    ${
                      isSending
                        ? html`
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <rect x="6" y="6" width="12" height="12" rx="1" />
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
                description: 'Manage your account session.'
              })}

              ${DialogFooter({
                children: html`
                  <div class="mt-5 flex justify-end gap-2">
                    ${Button({
                      variant: 'outline',
                      onClick: () => closeSettingsDialog(),
                      children: 'Cancel'
                    })}
                    ${Button({
                      variant: 'destructive',
                      onClick: () => void logoutCodex(),
                      disabled: state.authBusy,
                      children: state.authBusy ? 'Logging out' : 'Logout'
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
                class="mt-4 flex items-center gap-2 rounded-md bg-red-500/10 p-3 text-sm text-[#f5c2c0]"
              >
                ${icon(AlertTriangle, 'sm', 'text-[#f28b82]')}
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
void syncTerminalSessions()
void syncAuthState()
