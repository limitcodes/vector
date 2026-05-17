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
import type { ImageContent } from '@mariozechner/pi-ai'
import { spawn, type IPty } from 'node-pty'
import * as Diff from 'diff'
import { createPiProvider } from './agents/pi-provider'
import type { AgentModel, AgentProviderMetadata, StreamEvent, ThinkingLevel } from './agents/types'
import icon from '../../resources/icon.png?asset'

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

app.setName('Vector')
const agentProviders = [createPiProvider()]
const terminalSessions = new Map<string, TerminalRecord>()
let terminalSequence = 0
const execFileAsync = promisify(execFile)

const emitStreamEvent = (payload: StreamEvent): void => {
  mainWindow?.webContents.send('agent:stream-event', payload)
}

const emitTerminalEvent = (payload: TerminalEvent): void => {
  mainWindow?.webContents.send('terminal:event', payload)
}

const emitChatNotificationClickEvent = (payload: ChatNotificationClickEvent): void => {
  mainWindow?.webContents.send('chat-notification:click', payload)
}

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
  const shellPath = getDefaultShell()
  const resolvedCwd = cwd || homedir()
  const id = `terminal-${Date.now()}-${terminalSequence++}`
  const terminal = spawn(shellPath, getShellArgs(shellPath), {
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
    shell: shellPath,
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

const getAgentProvider = (providerId: string) => {
  return agentProviders.find((provider) => provider.metadata.id === providerId) ?? agentProviders[0]
}

const getAuthState = (): {
  loggedIn: boolean
  providers: AgentProviderMetadata[]
  models: AgentModel[]
  defaultModelId: string
} => {
  const models = agentProviders.flatMap((provider) => provider.getModels())
  return {
    loggedIn: agentProviders.some((provider) => provider.isConfigured()),
    providers: agentProviders.map((provider) => provider.metadata),
    models,
    defaultModelId: models[0]?.id ?? ''
  }
}

const normalizePromptImages = (value: unknown): ImageContent[] => {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null

      const record = entry as { type?: unknown; mimeType?: unknown; data?: unknown }
      if (record.type !== 'image') return null
      if (typeof record.mimeType !== 'string' || !record.mimeType.trim()) return null
      if (typeof record.data !== 'string' || !record.data.trim()) return null

      return {
        type: 'image' as const,
        mimeType: record.mimeType,
        data: record.data
      }
    })
    .filter((entry): entry is ImageContent => Boolean(entry))
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
    icon,
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
        images?: ImageContent[]
        modelId: string
        providerId?: string
        thinkingLevel: ThinkingLevel
      }
    ) => {
      try {
        const requestId = `${payload.chatId}-${Date.now()}`
        const model = getAuthState().models.find((entry) => entry.id === payload.modelId)
        const provider = getAgentProvider(payload.providerId ?? model?.providerId ?? '')
        void provider.sendMessage({
          chatId: payload.chatId,
          cwd: payload.cwd,
          prompt: payload.prompt,
          images: normalizePromptImages(payload.images),
          modelId: payload.modelId,
          options: {
            thinkingLevel: payload.thinkingLevel
          },
          requestId,
          emit: emitStreamEvent
        })
        return { ok: true as const, requestId }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      }
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
