import {
  Notification,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions
} from 'electron'
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { promisify } from 'util'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { Type } from '@mariozechner/pi-ai'
import { spawn, type IPty } from 'node-pty'
import * as Diff from 'diff'
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  ModelRegistry,
  type ToolDefinition,
  SessionManager
} from '../../node_modules/@mariozechner/pi-coding-agent/dist/index.js'
import icon from '../../resources/icon.png?asset'
import { VECTOR_SYSTEM_PROMPT } from './vector-system-prompt'

type PiSession = Awaited<ReturnType<typeof createAgentSession>>['session']

type SessionEvent = {
  type?: string
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
  toolCallId?: string
  toolName?: string
  args?: unknown
  partialResult?: unknown
  result?: unknown
  isError?: boolean
}

type ModelOption = {
  id: string
  name: string
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

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

type TerminalRecord = {
  id: string
  title: string
  cwd: string
  shell: string
  pty: IPty
  status: 'running' | 'exited'
  exitCode: number | null
}

type StreamEvent =
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

type QuestionSubmitPayload = {
  toolCallId: string
  cancelled?: boolean
  answers?: QuestionAnswer[]
}

type ChatNotificationClickEvent = {
  chatId: string
}

type ReviewFile = {
  path: string
  oldText: string
  newText: string
  added: number
  removed: number
}

let mainWindow: BrowserWindow | null = null
const authStorage = AuthStorage.create(join(app.getPath('userData'), 'auth.json'))
const modelRegistry = new ModelRegistry(authStorage)
const sessionCache = new Map<string, PiSession>()
const terminalSessions = new Map<string, TerminalRecord>()
let terminalSequence = 0
const execFileAsync = promisify(execFile)
const pendingQuestionRequests = new Map<
  string,
  {
    resolve: (payload: QuestionSubmitPayload) => void
  }
>()

const emitStreamEvent = (payload: StreamEvent): void => {
  mainWindow?.webContents.send('agent:stream-event', payload)
}

const emitTerminalEvent = (payload: TerminalEvent): void => {
  mainWindow?.webContents.send('terminal:event', payload)
}

const emitChatNotificationClickEvent = (payload: ChatNotificationClickEvent): void => {
  mainWindow?.webContents.send('chat-notification:click', payload)
}

const emitQuestionPromptEvent = (payload: QuestionPromptEvent): void => {
  mainWindow?.webContents.send('question:prompt', payload)
}

const parseQuestionnaire = (questionnaire: string): QuestionPromptQuestion[] => {
  const lines = questionnaire
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const questions: QuestionPromptQuestion[] = []
  let current: QuestionPromptQuestion | null = null
  let pendingTopic: string | null = null

  for (const line of lines) {
    const questionMatch = line.match(/^(?:\d+\.\s*)?\[question\]\s*(.+)$/i)
    if (questionMatch) {
      current = {
        index: questions.length + 1,
        question: questionMatch[1].trim(),
        topic: pendingTopic ?? `Question-${questions.length + 1}`,
        options: []
      }
      questions.push(current)
      pendingTopic = null
      continue
    }

    const topicMatch = line.match(/^\[topic\]\s*(.+)$/i)
    if (topicMatch) {
      if (current && current.options.length === 0) {
        current.topic = topicMatch[1].trim()
      } else {
        pendingTopic = topicMatch[1].trim()
      }
      continue
    }

    if (!current) {
      continue
    }

    const optionMatch = line.match(/^\[option\]\s*(.+)$/i)
    if (optionMatch) {
      current.options.push(optionMatch[1].trim())
    }
  }

  if (questions.length < 1 || questions.length > 4) {
    throw new Error('question tool requires 1-4 questions')
  }

  for (const question of questions) {
    if (!question.question) {
      throw new Error('question tool received an empty question')
    }
    if (!question.topic) {
      throw new Error(`question tool is missing a topic for question ${question.index}`)
    }
    if (question.options.length < 2 || question.options.length > 4) {
      throw new Error(
        `question tool requires 2-4 options for "${question.topic}", received ${question.options.length}`
      )
    }
  }

  return questions
}

const createQuestionTool = (chatId: string): ToolDefinition => ({
  name: 'question',
  label: 'Question',
  description:
    'Ask the user 1-4 short multiple-choice clarification questions and receive structured answers.',
  promptSnippet: 'Ask the user a short multiple-choice questionnaire when clarification is required.',
  parameters: Type.Object({
    questionnaire: Type.String({
      description:
        'A plain-text questionnaire using [question], [topic], and [option] lines with 1-4 questions and 2-4 options per question.'
    })
  }),
  async execute(toolCallId, params, signal) {
    const questionnaire =
      params && typeof params === 'object' && 'questionnaire' in params
        ? String((params as { questionnaire: string }).questionnaire ?? '')
        : ''
    const questions = parseQuestionnaire(questionnaire)

    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const response = await new Promise<QuestionSubmitPayload>((resolve, reject) => {
      pendingQuestionRequests.set(toolCallId, { resolve })

      const handleAbort = (): void => {
        pendingQuestionRequests.delete(toolCallId)
        reject(new Error('question tool cancelled'))
      }

      if (signal?.aborted) {
        handleAbort()
        return
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      emitQuestionPromptEvent({ chatId, toolCallId, questions })
    })

    pendingQuestionRequests.delete(toolCallId)

    if (response.cancelled) {
      throw new Error('question tool cancelled by user')
    }

    const answers = response.answers ?? []
    if (answers.length !== questions.length) {
      throw new Error('question tool did not receive a complete response')
    }

    const text = answers.map((answer) => `- ${answer.topic}: ${answer.answer}`).join('\n')

    return {
      content: [{ type: 'text', text: `User answers:\n${text}` }],
      details: { answers }
    }
  }
})

const focusMainWindow = (): void => {
  if (!mainWindow) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
}

const showChatCompletionNotification = ({
  chatId,
  title,
  body
}: {
  chatId: string
  title: string
  body: string
}): void => {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title,
    body
  })

  notification.on('click', () => {
    focusMainWindow()
    emitChatNotificationClickEvent({ chatId })
  })

  notification.show()
}

const toTerminalSummary = (terminal: TerminalRecord): TerminalSessionSummary => ({
  id: terminal.id,
  title: terminal.title,
  cwd: terminal.cwd,
  shell: terminal.shell,
  pid: terminal.pty.pid,
  status: terminal.status,
  exitCode: terminal.exitCode
})

const getDefaultShell = (): string => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }

  return process.env.SHELL || '/bin/bash'
}

const getShellArgs = (shellPath: string): string[] => {
  if (process.platform === 'win32') {
    return []
  }

  const executable = basename(shellPath).toLowerCase()
  if (executable === 'fish') return ['-l']
  return ['-l']
}

const createTerminalSession = ({
  cwd,
  title
}: {
  cwd?: string
  title?: string
}): TerminalSessionSummary => {
  const shell = getDefaultShell()
  const resolvedCwd = cwd || homedir()
  const id = `terminal-${Date.now()}-${terminalSequence++}`
  const terminal = spawn(shell, getShellArgs(shell), {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  })

  const record: TerminalRecord = {
    id,
    title: title?.trim() || `Terminal ${terminalSessions.size + 1}`,
    cwd: resolvedCwd,
    shell,
    pty: terminal,
    status: 'running',
    exitCode: null
  }

  terminal.onData((data) => {
    emitTerminalEvent({ type: 'output', terminalId: id, data })
  })

  terminal.onExit(({ exitCode }) => {
    const current = terminalSessions.get(id)
    if (!current) return

    current.status = 'exited'
    current.exitCode = exitCode
    emitTerminalEvent({ type: 'exit', terminalId: id, exitCode })
    terminalSessions.delete(id)
  })

  terminalSessions.set(id, record)
  return toTerminalSummary(record)
}

const killTerminalSession = (terminalId: string): void => {
  const terminal = terminalSessions.get(terminalId)
  if (!terminal) return

  terminal.pty.kill()
  terminalSessions.delete(terminalId)
}

const isProbablyBinary = (value: Buffer): boolean => {
  return value.includes(0)
}

const countLines = (value: string): number => {
  if (!value) return 0
  return value.split('\n').length
}

const getDiffStats = (
  oldText: string,
  newText: string
): {
  added: number
  removed: number
} => {
  let added = 0
  let removed = 0

  for (const part of Diff.diffLines(oldText, newText)) {
    if (!part.value) continue
    const lineCount = countLines(part.value)
    if (part.added) added += lineCount
    if (part.removed) removed += lineCount
  }

  return { added, removed }
}

const runGit = async (
  cwd: string,
  args: string[],
  encoding: BufferEncoding | 'buffer' = 'utf8'
): Promise<string | Buffer> => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: encoding === 'buffer' ? 'buffer' : encoding,
    maxBuffer: 16 * 1024 * 1024
  })

  return stdout as string | Buffer
}

const hasGitHead = async (cwd: string): Promise<boolean> => {
  try {
    await runGit(cwd, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

const readWorkspaceFile = async (cwd: string, relativePath: string): Promise<Buffer> => {
  return readFile(resolve(cwd, relativePath))
}

const readGitFile = async (cwd: string, relativePath: string): Promise<Buffer> => {
  const gitPath = relativePath.replaceAll('\\', '/')
  const output = await runGit(cwd, ['show', `HEAD:${gitPath}`], 'buffer')
  return Buffer.isBuffer(output) ? output : Buffer.from(output)
}

const parseGitStatusEntries = (
  statusOutput: string
): Array<{ path: string; originalPath?: string; x: string; y: string }> => {
  const entries = statusOutput.split('\0').filter(Boolean)
  const parsed: Array<{ path: string; originalPath?: string; x: string; y: string }> = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const x = entry[0] ?? ' '
    const y = entry[1] ?? ' '
    const path = entry.slice(3)
    const isRenameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C'

    if (isRenameOrCopy) {
      const originalPath = entries[index + 1]
      parsed.push({ path, originalPath, x, y })
      index += 1
      continue
    }

    parsed.push({ path, x, y })
  }

  return parsed
}

const getWorkspaceDiff = async (cwd: string): Promise<ReviewFile[]> => {
  try {
    await runGit(cwd, ['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error('Open a git workspace to review file changes.')
  }

  const statusOutput = await runGit(
    cwd,
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    'utf8'
  )
  const entries = parseGitStatusEntries(typeof statusOutput === 'string' ? statusOutput : '')
  const hasHead = await hasGitHead(cwd)
  const reviewFiles: ReviewFile[] = []

  for (const entry of entries) {
    if (!entry.path) continue
    if (entry.x === '!' || entry.y === '!') continue

    const isUntracked = entry.x === '?' && entry.y === '?'
    const isDeleted =
      (!isUntracked && (entry.x === 'D' || entry.y === 'D')) ||
      (entry.originalPath !== undefined && entry.path === '/dev/null')

    let oldBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let newBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

    try {
      if (!isUntracked && hasHead) {
        const oldPath = entry.originalPath ?? entry.path
        oldBuffer = await readGitFile(cwd, oldPath)
      }
    } catch {
      oldBuffer = Buffer.alloc(0)
    }

    try {
      if (!isDeleted) {
        newBuffer = await readWorkspaceFile(cwd, entry.path)
      }
    } catch {
      newBuffer = Buffer.alloc(0)
    }

    if (isProbablyBinary(oldBuffer) || isProbablyBinary(newBuffer)) {
      continue
    }

    const oldText = oldBuffer.toString('utf8')
    const newText = newBuffer.toString('utf8')
    const stats = getDiffStats(oldText, newText)

    if (stats.added === 0 && stats.removed === 0 && oldText === newText) {
      continue
    }

    reviewFiles.push({
      path: entry.path,
      oldText,
      newText,
      added: stats.added,
      removed: stats.removed
    })
  }

  return reviewFiles.sort((left, right) => left.path.localeCompare(right.path))
}

const compareModels = (left: ModelOption, right: ModelOption): number => {
  const byName = right.name.localeCompare(left.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
  if (byName !== 0) return byName

  return right.id.localeCompare(left.id, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

const getCodexModels = (): ModelOption[] => {
  return modelRegistry
    .getAll()
    .filter((model) => model.provider === 'openai-codex')
    .map((model) => ({ id: model.id, name: model.name }))
    .sort(compareModels)
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

const safeStringify = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined) return ''

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const extractTextFromToolPayload = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return safeStringify(value)

  const record = value as {
    content?: Array<{ type?: string; text?: string; content?: string }>
    stdout?: string
    stderr?: string
    output?: string
  }

  if (typeof record.stdout === 'string' || typeof record.stderr === 'string') {
    return [record.stdout, record.stderr].filter(Boolean).join(record.stdout && record.stderr ? '\n' : '')
  }

  if (typeof record.output === 'string') return record.output

  if (Array.isArray(record.content)) {
    const text = record.content
      .map((part) => {
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (text) return text
  }

  return safeStringify(value)
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
  modelId: string,
  thinkingLevel: ThinkingLevel
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
    cached.setThinkingLevel(thinkingLevel)
    return cached
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    systemPromptOverride: () => VECTOR_SYSTEM_PROMPT
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: [
      createReadTool(cwd),
      createBashTool(cwd),
      createEditTool(cwd),
      createWriteTool(cwd),
      createGrepTool(cwd),
      createFindTool(cwd),
      createLsTool(cwd)
    ],
    customTools: [createQuestionTool(chatId)],
    sessionManager: SessionManager.inMemory()
  })

  session.setThinkingLevel(thinkingLevel)
  sessionCache.set(chatId, session)
  return session
}

const streamPrompt = async (
  chatId: string,
  cwd: string,
  prompt: string,
  modelId: string,
  thinkingLevel: ThinkingLevel,
  requestId: string
): Promise<void> => {
  const session = await getOrCreateSession(chatId, cwd, modelId, thinkingLevel)
  let text = ''

  emitStreamEvent({ type: 'start', chatId, requestId })

  const unsubscribe = session.subscribe((event: unknown) => {
    const update = event as SessionEvent

    if (update.type === 'message_update') {
      if (update.assistantMessageEvent?.type === 'text_delta') {
        const delta = update.assistantMessageEvent.delta ?? ''
        text += delta
        emitStreamEvent({ type: 'text_delta', chatId, requestId, delta })
      }

      if (update.assistantMessageEvent?.type === 'thinking_delta') {
        emitStreamEvent({
          type: 'thinking_delta',
          chatId,
          requestId,
          delta: update.assistantMessageEvent.delta ?? ''
        })
      }

      return
    }

    if (update.type === 'tool_execution_start') {
      emitStreamEvent({
        type: 'tool_start',
        chatId,
        requestId,
        toolCallId: update.toolCallId ?? `${requestId}-tool-start`,
        toolName: update.toolName ?? 'tool',
        argsText: safeStringify(update.args)
      })
      return
    }

    if (update.type === 'tool_execution_update') {
      emitStreamEvent({
        type: 'tool_update',
        chatId,
        requestId,
        toolCallId: update.toolCallId ?? `${requestId}-tool-update`,
        toolName: update.toolName ?? 'tool',
        output: extractTextFromToolPayload(update.partialResult)
      })
      return
    }

    if (update.type === 'tool_execution_end') {
      emitStreamEvent({
        type: 'tool_end',
        chatId,
        requestId,
        toolCallId: update.toolCallId ?? `${requestId}-tool-end`,
        toolName: update.toolName ?? 'tool',
        output: extractTextFromToolPayload(update.result),
        isError: Boolean(update.isError)
      })
    }
  })

  try {
    await session.prompt(prompt)
    if (!text.trim()) {
      const fallback = extractAssistantText(session.messages as unknown[])
      if (fallback) {
        emitStreamEvent({ type: 'text_delta', chatId, requestId, delta: fallback })
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
    title: 'Vector',
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

  ipcMain.handle('auth:logout-codex', async () => {
    try {
      authStorage.logout('openai-codex')
      modelRegistry.refresh()
      sessionCache.clear()
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

  ipcMain.handle('review:get-workspace-diff', async (_event, payload: { cwd: string }) => {
    try {
      const files = await getWorkspaceDiff(payload.cwd)
      return { ok: true as const, files }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle(
    'agent:send-message',
    async (
      _event,
      payload: {
        chatId: string
        cwd: string
        prompt: string
        modelId: string
        thinkingLevel: ThinkingLevel
      }
    ) => {
      try {
        const requestId = `${payload.chatId}-${Date.now()}`
        void streamPrompt(
          payload.chatId,
          payload.cwd,
          payload.prompt,
          payload.modelId,
          payload.thinkingLevel,
          requestId
        )
        return { ok: true as const, requestId }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle(
    'question:submit',
    async (_event, payload: QuestionSubmitPayload) => {
      const request = pendingQuestionRequests.get(payload.toolCallId)
      if (!request) {
        return { ok: false as const, error: 'Question request not found' }
      }

      request.resolve(payload)
      return { ok: true as const }
    }
  )

  ipcMain.handle(
    'chat:show-notification',
    async (
      _event,
      payload: {
        chatId: string
        title: string
        body: string
      }
    ) => {
      try {
        showChatCompletionNotification(payload)
        return { ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle('terminal:list', async () =>
    Array.from(terminalSessions.values()).map((terminal) => toTerminalSummary(terminal))
  )

  ipcMain.handle(
    'terminal:create',
    async (_event, payload: { cwd?: string; title?: string } | undefined) => {
      try {
        const terminal = createTerminalSession(payload ?? {})
        return { ok: true as const, terminal }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle(
    'terminal:write',
    async (_event, payload: { terminalId: string; data: string }) => {
      try {
        const terminal = terminalSessions.get(payload.terminalId)
        if (!terminal) {
          throw new Error('Terminal not found')
        }

        terminal.pty.write(payload.data)
        return { ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle(
    'terminal:resize',
    async (_event, payload: { terminalId: string; cols: number; rows: number }) => {
      try {
        const terminal = terminalSessions.get(payload.terminalId)
        if (!terminal) {
          throw new Error('Terminal not found')
        }

        terminal.pty.resize(Math.max(1, payload.cols), Math.max(1, payload.rows))
        return { ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle('terminal:close', async (_event, payload: { terminalId: string }) => {
    try {
      killTerminalSession(payload.terminalId)
      return { ok: true as const }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false as const, error: message }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const terminalId of terminalSessions.keys()) {
    killTerminalSession(terminalId)
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
