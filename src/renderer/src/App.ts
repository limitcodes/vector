import { html, type TemplateResult } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { type DirectiveResult } from 'lit/directive.js'

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
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
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

interface AppState extends PersistedState {
  composer: string
  sendingChatId: string | null
  authChecked: boolean
  loggedIn: boolean
  authBusy: boolean
  authError: string | null
  models: ModelOption[]
  activeRequestId: string | null
  activeAssistantMessageId: string | null
  sidebarCollapsed: boolean
  expandedWorkspaces: Set<string>
  deleteChatId: string | null
}

const STORAGE_KEY = 'pi-ui.chats.v5'
const DEFAULT_WORKSPACE_PATH = '__no-folder__'

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
                            tool.status === 'done' || tool.status === 'error' ? tool.status : 'running'
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
        sendingChatId: null,
        authChecked: false,
        loggedIn: false,
        authBusy: false,
        authError: null,
        models: [],
        activeRequestId: null,
        activeAssistantMessageId: null,
        sidebarCollapsed: true,
        expandedWorkspaces: new Set<string>(),
        deleteChatId: null
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
    sendingChatId: null,
    authChecked: false,
    loggedIn: false,
    authBusy: false,
    authError: null,
    models: [],
    activeRequestId: null,
    activeAssistantMessageId: null,
    sidebarCollapsed: true,
    expandedWorkspaces: new Set<string>(),
    deleteChatId: null
  }
}

let state = loadState()
let notifyChange: (() => void) | undefined
let folderPickerInFlight = false
let unsubscribeStream: (() => void) | undefined
let composerTextarea: HTMLTextAreaElement | null = null

const syncComposerHeight = (): void => {
  if (!composerTextarea) return

  const minHeight = 74
  const maxHeight = 210
  composerTextarea.style.height = '0px'
  const nextHeight = Math.min(Math.max(composerTextarea.scrollHeight, minHeight), maxHeight)
  composerTextarea.style.height = `${nextHeight}px`
  composerTextarea.style.overflowY = composerTextarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

const updateAssistantMessage = (
  current: AppState,
  chatId: string,
  updater: (message: Message) => Message
): AppState => {
  return {
    ...current,
    chats: sortChats(
      current.chats.map((chat) => {
        if (chat.id !== chatId) return chat
        return {
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === current.activeAssistantMessageId ? updater(message) : message
          ),
          updatedAt: now()
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

export const setAppChangeListener = (listener: () => void): void => {
  notifyChange = listener
}

export const setStreamCleanup = (
  subscribe: (listener: (event: AgentStreamEvent) => void) => () => void
): void => {
  unsubscribeStream?.()
  unsubscribeStream = subscribe((event) => {
    updateState((current) => {
      if (event.requestId !== current.activeRequestId || event.chatId !== current.sendingChatId) {
        return current
      }

      if (event.type === 'start') {
        return current
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
        return {
          ...updateAssistantMessage(current, event.chatId, (message) => ({
            ...message,
            streaming: false
          })),
          sendingChatId: null,
          activeRequestId: null,
          activeAssistantMessageId: null
        }
      }

      if (event.type === 'error') {
        return {
          ...updateAssistantMessage(current, event.chatId, (message) => ({
            ...message,
            content: message.content || `Agent error: ${event.error}`,
            streaming: false
          })),
          sendingChatId: null,
          activeRequestId: null,
          activeAssistantMessageId: null
        }
      }

      return current
    })
  })
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

const createChatForWorkspace = (workspacePath: string): void => {
  if (workspacePath === DEFAULT_WORKSPACE_PATH || state.sendingChatId || !state.loggedIn) return

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
}

const createNewChat = (): void => {
  createChatForWorkspace(getActiveWorkspace().path)
}

const selectChat = (chatId: string): void => {
  updateState((current) => {
    const chat = current.chats.find((entry) => entry.id === chatId)
    if (!chat) return current

    return {
      ...current,
      activeWorkspacePath: chat.workspacePath,
      activeChatId: chatId
    }
  })
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

const openDeleteChatDialog = (chatId: string): void => {
  updateState((current) => ({
    ...current,
    deleteChatId: chatId
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
  if (!targetChatId || state.sendingChatId === targetChatId) return

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

    return {
      ...current,
      chats,
      activeWorkspacePath: chatToDelete.workspacePath,
      activeChatId:
        current.activeChatId === targetChatId ? (fallbackChat?.id ?? '') : current.activeChatId,
      deleteChatId: null
    }
  })
}

const openFolder = async (): Promise<void> => {
  if (folderPickerInFlight || state.sendingChatId || !state.loggedIn) return
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

      return {
        ...current,
        workspaces,
        chats,
        activeWorkspacePath: folder.path,
        activeChatId: activeChat.id,
        composer: ''
      }
    })
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
    state.sendingChatId !== null ||
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
    sendingChatId: activeChat.id,
    activeAssistantMessageId: assistantMessageId,
    activeRequestId: null
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
      sendingChatId: null,
      activeRequestId: null,
      activeAssistantMessageId: null,
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
      )
    }))
    return
  }

  updateState((current) => ({
    ...current,
    activeRequestId: result.requestId
  }))
}

const onGlobalKeyDown = (event: KeyboardEvent): void => {
  const modifier = event.metaKey || event.ctrlKey
  const target = event.target as HTMLElement | null
  const isTextInput =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target?.isContentEditable === true

  if (modifier && event.key.toLowerCase() === 'a' && target instanceof HTMLTextAreaElement) {
    event.preventDefault()
    target.select()
    return
  }

  if (modifier && event.key === 'Enter' && state.loggedIn) {
    event.preventDefault()
    void sendMessage()
    return
  }

  if (modifier && event.key.toLowerCase() === 'b' && state.loggedIn && !isTextInput) {
    event.preventDefault()
    toggleSidebar()
    return
  }

  if (modifier && event.key.toLowerCase() === 'n' && state.loggedIn && !isTextInput) {
    event.preventDefault()
    createNewChat()
    return
  }

  if (modifier && event.key.toLowerCase() === 'o' && state.loggedIn && !isTextInput) {
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

const renderChatList = (workspace: Workspace, activeChatId: string): TemplateResult => {
  const chats = getChatsForWorkspace(workspace.path, state.chats)

  return html`
    <div class="space-y-1 pl-7">
      ${chats.map((chat) => {
        const isActive = chat.id === activeChatId
        const canDelete = state.sendingChatId !== chat.id

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
              <span class="min-w-0 truncate text-[13px] font-medium leading-none text-[#f5f5f5]">
                ${chat.title}
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
                ?disabled=${activeWorkspace.path === DEFAULT_WORKSPACE_PATH ||
                state.sendingChatId !== null}
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
                  ?disabled=${state.sendingChatId !== null}
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
                                ?disabled=${state.sendingChatId !== null}
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
            </aside>
          `}
    </div>
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
      <summary class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[#8f8f8f]">
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
          ? html`<span class=${['text-[12px] font-medium', statusTone].join(' ')}>${statusLabel}</span>`
          : ''}
      </summary>
      <div class="pt-2">
        ${tool.argsText
          ? html`<pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[#2d2d2d] px-3 py-2 text-xs leading-5 text-[#bdbdbd]">${tool.argsText}</pre>`
          : ''}
        ${tool.output
          ? html`<pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[#2a2a2a] px-3 py-2 text-xs leading-5 text-[#d8d8d8]">${tool.output}</pre>`
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
                      <summary class="flex cursor-pointer list-none items-center gap-1.5 py-1 select-none marker:hidden text-[#8f8f8f]">
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

              ${tools.length > 0 ? html`<div class="space-y-1">${tools.map((tool) => renderToolInvocation(tool))}</div>` : ''}

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
  const hasWorkspace = activeWorkspace.path !== DEFAULT_WORKSPACE_PATH
  const isSending = state.sendingChatId === activeChat?.id

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

      ${renderSidebar(activeWorkspace, activeChat?.id ?? '')}

      <main class="flex min-w-0 flex-1 bg-[#2f2f2f] px-6 py-6">
        <div class="flex h-full w-full flex-col">
          <section class="flex min-h-0 flex-1 flex-col">
            <div class="flex min-h-0 flex-1 justify-center overflow-hidden">
              <div class="w-full max-w-[760px] overflow-y-auto px-1" ${scrollToBottom()}>
                <div class="space-y-[18px] pt-16">
                  ${activeChat
                    ? activeChat.messages.map((message) => renderMessage(message))
                    : renderNoWorkspaceState()}
                </div>
              </div>
            </div>

            <div class="flex shrink-0 justify-center pb-1 pt-8">
              <div
                class="relative w-full max-w-[760px] rounded-[24px] border border-[#505050] bg-[#3a3a3a] px-[18px] pb-3 pt-2.5"
              >
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
                      options: state.models.map((model) => ({ value: model.id, label: model.name })),
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
                      options: THINKING_LEVELS.map((level) => ({ value: level.id, label: level.label })),
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
                    title=${isSending
                      ? 'Assistant responding. This becomes a stop control.'
                      : 'Send message'}
                    ?disabled=${(!state.composer.trim() || !activeChat) && !isSending}
                    @click=${() => void sendMessage()}
                  >
                  ${isSending
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
                          <path d="M17 3.34a10 10 0 1 1-14.995 8.984L2 12l.005-.324A10 10 0 0 1 17 3.34M12.02 7l-.163.01l-.086.016l-.142.045l-.113.054l-.07.043l-.095.071l-.058.054l-4 4l-.083.094a1 1 0 0 0 1.497 1.32L11 10.414V16l.007.117A1 1 0 0 0 13 16v-5.585l2.293 2.292l.094.083a1 1 0 0 0 1.32-1.497l-4-4l-.082-.073l-.089-.064l-.113-.062l-.081-.034l-.113-.034l-.112-.02z" />
                        </svg>
                      `}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

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

              <div class="mt-4 flex items-center gap-2 rounded-md bg-red-500/10 p-3 text-sm text-[#f5c2c0]">
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
void syncAuthState()
