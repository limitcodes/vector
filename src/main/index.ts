import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { basename, join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  ModelRegistry,
  SessionManager
} from '../../node_modules/@mariozechner/pi-coding-agent/dist/index.js'
import icon from '../../resources/icon.png?asset'

type PiSession = Awaited<ReturnType<typeof createAgentSession>>['session']

type MessageUpdateEvent = {
  type?: string
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
}

type ModelOption = {
  id: string
  name: string
}

type StreamEvent =
  | { type: 'start'; chatId: string; requestId: string }
  | { type: 'delta'; chatId: string; requestId: string; delta: string }
  | { type: 'end'; chatId: string; requestId: string }
  | { type: 'error'; chatId: string; requestId: string; error: string }

let mainWindow: BrowserWindow | null = null
const authStorage = AuthStorage.create(join(app.getPath('userData'), 'auth.json'))
const modelRegistry = new ModelRegistry(authStorage)
const sessionCache = new Map<string, PiSession>()

const emitStreamEvent = (payload: StreamEvent): void => {
  mainWindow?.webContents.send('agent:stream-event', payload)
}

const getCodexModels = (): ModelOption[] => {
  return modelRegistry
    .getAll()
    .filter((model) => model.provider === 'openai-codex')
    .map((model) => ({ id: model.id, name: model.name }))
}

const getAuthState = (): { loggedIn: boolean; models: ModelOption[]; defaultModelId: string } => {
  const models = getCodexModels()
  return {
    loggedIn: authStorage.has('openai-codex'),
    models,
    defaultModelId: models.find((model) => model.id === 'gpt-5.4')?.id ?? models[0]?.id ?? 'gpt-5.4'
  }
}

const promptInRenderer = async (message: string): Promise<string> => {
  if (!mainWindow) {
    throw new Error('Login prompt unavailable')
  }

  const result = await mainWindow.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(message)}) ?? ''`,
    true
  )

  return typeof result === 'string' ? result : ''
}

const loginCodex = async (): Promise<void> => {
  await authStorage.login('openai-codex', {
    onAuth: ({ url }) => {
      void shell.openExternal(url)
    },
    onPrompt: async ({ message }) => promptInRenderer(message)
  })
}

const extractAssistantText = (messages: unknown[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: string
      content?: Array<{ type?: string; text?: string }>
    }

    if (message?.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }

    const text = message.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim()

    if (text) return text
  }

  return ''
}

const getOrCreateSession = async (
  chatId: string,
  cwd: string,
  modelId: string
): Promise<PiSession> => {
  if (!authStorage.has('openai-codex')) {
    throw new Error('Log in with ChatGPT Plus/Pro before starting a chat.')
  }

  const model = modelRegistry.find('openai-codex', modelId)
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`)
  }

  const cached = sessionCache.get(chatId)
  if (cached) {
    if (cached.model?.id !== model.id || cached.model?.provider !== model.provider) {
      await cached.setModel(model)
    }
    return cached
  }

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    tools: createCodingTools(cwd),
    sessionManager: SessionManager.inMemory()
  })

  sessionCache.set(chatId, session)
  return session
}

const streamPrompt = async (
  chatId: string,
  cwd: string,
  prompt: string,
  modelId: string,
  requestId: string
): Promise<void> => {
  const session = await getOrCreateSession(chatId, cwd, modelId)
  let text = ''

  emitStreamEvent({ type: 'start', chatId, requestId })

  const unsubscribe = session.subscribe((event: unknown) => {
    const update = event as MessageUpdateEvent
    if (update.type === 'message_update' && update.assistantMessageEvent?.type === 'text_delta') {
      const delta = update.assistantMessageEvent.delta ?? ''
      text += delta
      emitStreamEvent({ type: 'delta', chatId, requestId, delta })
    }
  })

  try {
    await session.prompt(prompt)
    if (!text.trim()) {
      const fallback = extractAssistantText(session.messages as unknown[])
      if (fallback) {
        emitStreamEvent({ type: 'delta', chatId, requestId, delta: fallback })
      }
    }
    emitStreamEvent({ type: 'end', chatId, requestId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStreamEvent({ type: 'error', chatId, requestId, error: message })
  } finally {
    unsubscribe()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: 'pi UI',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('auth:get-state', async () => getAuthState())

  ipcMain.handle('auth:login-codex', async () => {
    try {
      await loginCodex()
      modelRegistry.refresh()
      return { ok: true as const, state: getAuthState() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('dialog:open-folder', async () => {
    const options: OpenDialogOptions = {
      title: 'Open Folder',
      properties: ['openDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    return {
      path: folderPath,
      name: basename(folderPath)
    }
  })

  ipcMain.handle(
    'agent:send-message',
    async (_event, payload: { chatId: string; cwd: string; prompt: string; modelId: string }) => {
      try {
        const requestId = `${payload.chatId}-${Date.now()}`
        void streamPrompt(payload.chatId, payload.cwd, payload.prompt, payload.modelId, requestId)
        return { ok: true as const, requestId }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
