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
import {
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen
} from 'lucide'

type Role = 'user' | 'assistant'

type ModelOption = {
  id: string
  name: string
}

type AgentStreamEvent =
  | { type: 'start'; chatId: string; requestId: string }
  | { type: 'delta'; chatId: string; requestId: string; delta: string }
  | { type: 'end'; chatId: string; requestId: string }
  | { type: 'error'; chatId: string; requestId: string; error: string }

interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  streaming?: boolean
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
}

const STORAGE_KEY = 'pi-ui.chats.v3'
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
      const chats = Array.isArray(parsed.chats) ? sortChats(parsed.chats) : []
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
        expandedWorkspaces: new Set<string>()
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
    expandedWorkspaces: new Set<string>()
  }
}

let state = loadState()
let notifyChange: (() => void) | undefined
let folderPickerInFlight = false
let unsubscribeStream: (() => void) | undefined

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

      if (event.type === 'delta') {
        return {
          ...current,
          chats: sortChats(
            current.chats.map((chat) => {
              if (chat.id !== event.chatId) return chat
              return {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === current.activeAssistantMessageId
                    ? { ...message, content: message.content + event.delta, streaming: true }
                    : message
                ),
                updatedAt: now()
              }
            })
          )
        }
      }

      if (event.type === 'end') {
        return {
          ...current,
          sendingChatId: null,
          activeRequestId: null,
          activeAssistantMessageId: null,
          chats: sortChats(
            current.chats.map((chat) => {
              if (chat.id !== event.chatId) return chat
              return {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === current.activeAssistantMessageId
                    ? { ...message, streaming: false }
                    : message
                ),
                updatedAt: now()
              }
            })
          )
        }
      }

      return {
        ...current,
        sendingChatId: null,
        activeRequestId: null,
        activeAssistantMessageId: null,
        chats: sortChats(
          current.chats.map((chat) => {
            if (chat.id !== event.chatId) return chat
            return {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === current.activeAssistantMessageId
                  ? {
                      ...message,
                      content: message.content || `Agent error: ${event.error}`,
                      streaming: false
                    }
                  : message
              ),
              updatedAt: now()
            }
          })
        )
      }
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
            createdAt: message.createdAt
          }))
        })),
        activeWorkspacePath: state.activeWorkspacePath,
        activeChatId: state.activeChatId,
        selectedModelId: state.selectedModelId
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
}

const getActiveWorkspace = (): Workspace => {
  return getWorkspaceByPath(state.workspaces, state.activeWorkspacePath)
}

const getActiveChat = (): Chat | undefined => {
  return state.chats.find((chat) => chat.id === state.activeChatId)
}

const createNewChat = (): void => {
  const workspace = getActiveWorkspace()
  if (workspace.path === DEFAULT_WORKSPACE_PATH || state.sendingChatId || !state.loggedIn) return

  const chat = createChat(workspace)
  updateState((current) => ({
    ...current,
    chats: sortChats([chat, ...current.chats]),
    activeChatId: chat.id,
    composer: ''
  }))
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
    streaming: true
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
    modelId: state.selectedModelId
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
  if (modifier && event.key === 'Enter' && state.loggedIn) {
    event.preventDefault()
    void sendMessage()
  }

  if (modifier && event.key.toLowerCase() === 'o' && state.loggedIn) {
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

const renderChatList = (workspace: Workspace, activeChatId: string): TemplateResult => {
  const chats = getChatsForWorkspace(workspace.path, state.chats)

  return html`
    <div class="space-y-1 pl-7">
      ${chats.map((chat) => {
        const isActive = chat.id === activeChatId
        return html`
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
            <span class="shrink-0 text-[13px] leading-none text-[#b3b3b3]">
              ${formatRelativeTime(chat.updatedAt)}
            </span>
          </button>
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
                            <button
                              type="button"
                              class="flex w-full items-center gap-2 px-3 py-2 text-left"
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

const renderMessage = (message: Message): TemplateResult => {
  const isAssistant = message.role === 'assistant'
  return html`
    <div class=${['flex w-full', isAssistant ? 'justify-start' : 'justify-end'].join(' ')}>
      ${isAssistant
        ? html`
            <div class="max-w-[520px] text-[15px] leading-[1.55] text-[#f5f5f5]">
              <p class="whitespace-pre-wrap break-words text-[#f5f5f5]">${message.content}</p>
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
              <p class="whitespace-pre-wrap break-words">${message.content}</p>
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

            <div class="flex shrink-0 justify-center pb-6 pt-8">
              <div
                class="relative w-full max-w-[760px] rounded-[24px] border border-[#505050] bg-[#3a3a3a] px-[18px] py-5"
              >
                <textarea
                  class="h-[72px] w-full resize-none bg-transparent pr-14 text-[18px] font-medium leading-7 text-[#f5f5f5] outline-none placeholder:text-[#a3a3a3] disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder=${hasWorkspace ? 'Build anything' : 'Open a folder to start'}
                  .value=${state.composer}
                  ?disabled=${!activeChat}
                  @input=${(event: Event) => {
                    setComposer((event.target as HTMLTextAreaElement).value)
                  }}
                ></textarea>

                <button
                  type="button"
                  class="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-50"
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
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path
                            d="M21.864 3.549L15.41 21.417a1.55 1.55 0 0 1-1.41.903a1.54 1.54 0 0 1-1.394-.874l-2.88-5.759zM20.45 2.135L8.311 14.273l-5.728-2.864A1.55 1.55 0 0 1 1.68 10c0-.606.353-1.157.981-1.44z"
                          />
                          <path
                            d="M21.864 3.549L15.41 21.417a1.55 1.55 0 0 1-1.41.903a1.54 1.54 0 0 1-1.394-.874l-2.88-5.759z"
                          />
                        </svg>
                      `}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  `
}

window.addEventListener('keydown', onGlobalKeyDown)
void syncAuthState()
