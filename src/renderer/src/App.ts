import { html, type TemplateResult } from 'lit'
import { Button } from '@mariozechner/mini-lit/dist/Button.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@mariozechner/mini-lit/dist/Card.js'
import { Textarea } from '@mariozechner/mini-lit/dist/Textarea.js'
import { Badge } from '@mariozechner/mini-lit/dist/Badge.js'
import { Separator } from '@mariozechner/mini-lit/dist/Separator.js'
import { Select } from '@mariozechner/mini-lit/dist/Select.js'
import { icon } from '@mariozechner/mini-lit/dist/icons.js'
import { Bot, FolderOpen, LoaderCircle, LogIn, MessageSquare, Plus, Send, User } from 'lucide'

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

const createWelcomeMessage = (workspaceName: string): Message => ({
  id: createId(),
  role: 'assistant',
  content: `Workspace ready: ${workspaceName}. This chat uses the selected folder as the pi SDK cwd.`,
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
    messages: [createWelcomeMessage(workspace.name)]
  }
}

const fallbackWorkspace: Workspace = {
  path: DEFAULT_WORKSPACE_PATH,
  name: 'No folder selected',
  createdAt: now()
}

const formatTime = (value: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(value)

const getChatTitleFromInput = (content: string): string => {
  const clean = content.trim().replace(/\s+/g, ' ')
  if (!clean) return 'New chat'
  return clean.slice(0, 40)
}

const getPreview = (chat: Chat): string => {
  const lastMessage = chat.messages[chat.messages.length - 1]
  return lastMessage ? lastMessage.content.slice(0, 56) : 'No messages yet'
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
        activeAssistantMessageId: null
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
    activeAssistantMessageId: null
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

const setSelectedModelId = (modelId: string): void => {
  updateState((current) => ({
    ...current,
    selectedModelId: modelId
  }))
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

const selectWorkspace = (workspacePath: string): void => {
  updateState((current) => {
    const workspaceChats = getChatsForWorkspace(workspacePath, current.chats)
    return {
      ...current,
      activeWorkspacePath: workspacePath,
      activeChatId: workspaceChats[0]?.id ?? '',
      composer: ''
    }
  })
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

const renderChatList = (workspace: Workspace, activeChatId: string): TemplateResult => {
  const chats = getChatsForWorkspace(workspace.path, state.chats)

  return html`
    <div class="mt-3 space-y-2">
      ${chats.map((chat) => {
        const isActive = chat.id === activeChatId
        const isSending = state.sendingChatId === chat.id
        return html`
          <button
            type="button"
            class=${[
              'w-full rounded-xl border p-3 text-left transition-colors',
              isActive
                ? 'border-primary bg-background shadow-sm'
                : 'border-transparent bg-transparent hover:border-border hover:bg-background/70'
            ].join(' ')}
            @click=${() => selectChat(chat.id)}
          >
            <div class="mb-1 flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                ${icon(MessageSquare, 'sm', 'text-muted-foreground')}
                <span class="truncate text-sm font-medium text-foreground">${chat.title}</span>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">
                ${isSending ? '...' : formatTime(chat.updatedAt)}
              </span>
            </div>
            <p class="line-clamp-2 text-xs text-muted-foreground">${getPreview(chat)}</p>
          </button>
        `
      })}
    </div>
  `
}

const renderSidebar = (activeWorkspace: Workspace, activeChatId: string): TemplateResult => {
  return html`
    <aside
      class="flex h-full w-[320px] min-w-[320px] flex-col border-r border-border bg-muted/30 px-4 py-4"
    >
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-muted-foreground">pi UI</div>
          <div class="text-lg font-semibold text-foreground">Workspaces</div>
        </div>
        ${Badge({ children: `${state.workspaces.length}`, variant: 'secondary' })}
      </div>

      <div class="grid gap-2">
        ${Button({
          className: 'w-full justify-center gap-2',
          disabled: state.sendingChatId !== null,
          onClick: () => void openFolder(),
          children: html`${icon(FolderOpen, 'sm')}<span>Open folder</span>`
        })}
        ${Button({
          className: 'w-full justify-center gap-2',
          variant: 'secondary',
          disabled: activeWorkspace.path === DEFAULT_WORKSPACE_PATH || state.sendingChatId !== null,
          onClick: () => createNewChat(),
          children: html`${icon(Plus, 'sm')}<span>New chat</span>`
        })}
      </div>

      <p class="mt-3 text-xs text-muted-foreground">
        Cmd/Ctrl + O opens Finder and sets the workspace.
      </p>

      <div class="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        ${state.workspaces.length === 0
          ? html`
              ${Card({
                className: 'border-dashed bg-background/70 shadow-none',
                children: html`
                  ${CardContent({
                    className: 'p-4 text-sm text-muted-foreground',
                    children: 'Open a folder to group chats by workspace.'
                  })}
                `
              })}
            `
          : state.workspaces.map((workspace) => {
              const isActive = workspace.path === activeWorkspace.path
              const workspaceChats = getChatsForWorkspace(workspace.path, state.chats)

              return html`
                <section class="rounded-2xl border border-border/70 bg-background/60 p-3">
                  <button
                    type="button"
                    class="flex w-full items-start justify-between gap-3 text-left"
                    @click=${() => selectWorkspace(workspace.path)}
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        ${icon(
                          FolderOpen,
                          'sm',
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                        <span class="truncate text-sm font-semibold text-foreground">
                          ${workspace.name}
                        </span>
                      </div>
                      <p class="mt-1 truncate text-xs text-muted-foreground">${workspace.path}</p>
                    </div>
                    ${Badge({
                      children: `${workspaceChats.length}`,
                      variant: isActive ? 'default' : 'outline'
                    })}
                  </button>

                  ${renderChatList(workspace, activeChatId)}
                </section>
              `
            })}
      </div>
    </aside>
  `
}

const renderNoWorkspaceState = (): TemplateResult => {
  return Card({
    className:
      'mx-auto flex w-full max-w-2xl flex-col items-center border-dashed bg-background/70 text-center',
    children: html`
      ${CardHeader({
        className: 'items-center text-center',
        children: html`
          <div
            class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            ${icon(FolderOpen, 'md')}
          </div>
          ${CardTitle('Open a workspace folder')}
          ${CardDescription(
            'Use the sidebar button or Cmd/Ctrl + O. Each folder gets its own chat group.'
          )}
        `
      })}
    `
  })
}

const renderMessage = (message: Message): TemplateResult => {
  const isAssistant = message.role === 'assistant'
  return html`
    <div class=${['flex w-full', isAssistant ? 'justify-start' : 'justify-end'].join(' ')}>
      <div
        class=${['flex max-w-[68%] items-start gap-3', isAssistant ? '' : 'flex-row-reverse'].join(
          ' '
        )}
      >
        <div
          class=${[
            'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
            isAssistant ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
          ].join(' ')}
        >
          ${icon(isAssistant ? Bot : User, 'sm')}
        </div>

        ${Card({
          className: [
            'min-w-0 max-w-full w-fit shadow-none',
            isAssistant ? 'bg-card' : 'border-primary/20 bg-primary/8'
          ].join(' '),
          children: html`
            ${CardContent({
              className: 'space-y-2 px-3.5 py-2.5',
              children: html`
                <div
                  class="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  <span>${isAssistant ? 'Assistant' : 'You'}</span>
                  ${message.streaming ? html`${icon(LoaderCircle, 'xs', 'animate-spin')}` : ''}
                </div>
                ${isAssistant
                  ? html`<markdown-block .content=${message.content}></markdown-block>`
                  : html`<p
                      class="whitespace-pre-wrap break-words text-sm leading-5 text-foreground"
                    >
                      ${message.content}
                    </p>`}
              `
            })}
            ${CardFooter({
              className: 'px-3.5 pb-2.5 pt-0 text-[11px] text-muted-foreground',
              children: formatTime(message.createdAt)
            })}
          `
        })}
      </div>
    </div>
  `
}

const renderOnboarding = (): TemplateResult => {
  return html`
    <div class="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      ${Card({
        className: 'w-full max-w-xl shadow-sm',
        children: html`
          ${CardHeader({
            className: 'space-y-3',
            children: html`
              ${Badge('OpenAI Codex only', 'outline')} ${CardTitle('Log in to start')}
              ${CardDescription(
                'This app ignores environment variables and only unlocks after ChatGPT Plus/Pro OAuth login.'
              )}
            `
          })}
          ${CardContent({
            className: 'space-y-4',
            children: html`
              <div
                class="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
              >
                <p>1. Click login</p>
                <p>2. Complete ChatGPT Plus/Pro OAuth in the browser</p>
                <p>3. Return here and start chatting in a selected folder</p>
              </div>
              ${state.authError
                ? html`
                    <div
                      class="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    >
                      ${state.authError}
                    </div>
                  `
                : ''}
            `
          })}
          ${CardFooter({
            className: 'justify-end px-6 pb-6',
            children: Button({
              onClick: () => void loginCodex(),
              disabled: state.authBusy,
              className: 'gap-2',
              children: state.authBusy
                ? html`${icon(LoaderCircle, 'sm', 'animate-spin')}<span>Logging in</span>`
                : html`${icon(LogIn, 'sm')}<span>Login with ChatGPT</span>`
            })
          })}
        `
      })}
    </div>
  `
}

export const App = (): TemplateResult => {
  if (!state.authChecked) {
    return html`
      <div class="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        ${Card({
          className: 'w-full max-w-md shadow-sm',
          children: html`
            ${CardContent({
              className: 'flex items-center gap-3 p-6 text-sm text-muted-foreground',
              children: html`${icon(LoaderCircle, 'sm', 'animate-spin')}<span
                  >Checking login…</span
                >`
            })}
          `
        })}
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
    <div class="flex h-screen bg-background text-foreground">
      ${renderSidebar(activeWorkspace, activeChat?.id ?? '')}

      <main class="flex min-w-0 flex-1 justify-center bg-background px-6 py-6">
        <div class="flex h-full w-full max-w-5xl flex-col">
          <header class="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 pb-4">
            <div class="min-w-0">
              <h1 class="truncate text-xl font-semibold text-foreground">
                ${hasWorkspace ? activeWorkspace.name : 'No folder selected'}
              </h1>
              <p class="truncate text-sm text-muted-foreground">
                ${hasWorkspace
                  ? activeWorkspace.path
                  : 'Open a folder to start a workspace-scoped chat.'}
              </p>
            </div>
            ${Badge(
              isSending ? 'Running' : hasWorkspace ? 'Workspace active' : 'No workspace',
              isSending ? 'secondary' : hasWorkspace ? 'default' : 'outline'
            )}
          </header>

          ${Separator('horizontal', 'mb-4')}

          <section class="flex min-h-0 flex-1 justify-center overflow-hidden">
            <div class="flex h-full w-full max-w-3xl flex-col">
              <div class="flex-1 overflow-y-auto px-1 pb-6">
                <div class="space-y-4">
                  ${activeChat
                    ? activeChat.messages.map((message) => renderMessage(message))
                    : renderNoWorkspaceState()}
                </div>
              </div>

              <div class="pb-2 pt-4">
                ${Card({
                  className: 'mx-auto w-full max-w-3xl shadow-sm',
                  children: html`
                    ${CardContent({
                      className: 'space-y-3 p-3',
                      children: html`
                        ${Textarea({
                          value: state.composer,
                          placeholder: hasWorkspace
                            ? 'Type a message. Use Cmd/Ctrl + Enter to send.'
                            : 'Open a folder first with Cmd/Ctrl + O.',
                          rows: 4,
                          resize: 'none',
                          disabled: !activeChat || isSending,
                          onInput: (event) => {
                            setComposer((event.target as HTMLTextAreaElement).value)
                          },
                          className: 'border-0 bg-transparent shadow-none focus-visible:ring-0'
                        })}

                        <div class="flex flex-wrap items-center justify-between gap-3">
                          <div class="flex min-w-0 flex-1 items-center gap-3">
                            ${Select({
                              value: state.selectedModelId,
                              options: state.models.map((model) => ({
                                value: model.id,
                                label: model.name
                              })),
                              onChange: (value) => setSelectedModelId(value),
                              disabled: isSending,
                              size: 'sm',
                              width: '220px'
                            })}
                            <p class="flex items-center gap-2 text-xs text-muted-foreground">
                              ${isSending
                                ? html`${icon(LoaderCircle, 'sm', 'animate-spin')}<span
                                      >Streaming in ${activeWorkspace.path}</span
                                    >`
                                : hasWorkspace
                                  ? `pi SDK cwd = ${activeWorkspace.path}`
                                  : 'Chats unlock after choosing a workspace folder.'}
                            </p>
                          </div>

                          ${Button({
                            onClick: () => void sendMessage(),
                            disabled: !state.composer.trim() || !activeChat || isSending,
                            className: 'gap-2',
                            children: html`${icon(Send, 'sm')}<span
                                >${isSending ? 'Streaming' : 'Send'}</span
                              >`
                          })}
                        </div>
                      `
                    })}
                  `
                })}
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
