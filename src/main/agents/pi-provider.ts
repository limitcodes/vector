import { supportsXhigh, type Api, type Model } from '@mariozechner/pi-ai'
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  ModelRegistry,
  SessionManager
} from '../../../node_modules/@mariozechner/pi-coding-agent/dist/index.js'
import type { AgentModel, AgentProvider, AgentRequest, ThinkingLevel } from './types'

const PI_PROVIDER_ID = 'pi'

const PI_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
  <path fill="#fff" fill-rule="evenodd" d="
    M165.29 165.29
    H517.36
    V400
    H400
    V517.36
    H282.65
    V634.72
    H165.29
    Z
    M282.65 282.65
    V400
    H400
    V282.65
    Z
  "/>
  <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
</svg>`

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

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh'
}

const compareModels = (left: AgentModel, right: AgentModel): number => {
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

const getThinkingLevelsForModel = (model: Model<Api>): ThinkingLevel[] => {
  if (!model.reasoning) return ['off']
  return supportsXhigh(model)
    ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    : ['off', 'minimal', 'low', 'medium', 'high']
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
    return [record.stdout, record.stderr]
      .filter(Boolean)
      .join(record.stdout && record.stderr ? '\n' : '')
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

export const createPiProvider = (): AgentProvider => {
  const authStorage = AuthStorage.create()
  const modelRegistry = new ModelRegistry(authStorage)
  const sessionCache = new Map<string, PiSession>()

  const getModels = (): AgentModel[] => {
    modelRegistry.refresh()
    return modelRegistry
      .getAvailable()
      .map((model) => {
        const thinkingLevels = getThinkingLevelsForModel(model)
        return {
          id: JSON.stringify({ provider: model.provider, modelId: model.id }),
          name: `${model.name} (${model.provider})`,
          providerId: PI_PROVIDER_ID,
          optionGroups: [
            {
              id: 'thinking' as const,
              label: 'Thinking',
              options: thinkingLevels.map((level) => ({
                id: level,
                label: THINKING_LEVEL_LABELS[level]
              }))
            }
          ]
        }
      })
      .sort(compareModels)
  }

  const getModel = (modelId: string): Model<Api> | undefined => {
    modelRegistry.refresh()

    try {
      const parsed = JSON.parse(modelId) as { provider?: unknown; modelId?: unknown }
      if (typeof parsed.provider === 'string' && typeof parsed.modelId === 'string') {
        return modelRegistry.find(parsed.provider, parsed.modelId)
      }
    } catch {
      return undefined
    }

    return undefined
  }

  const getOrCreateSession = async (
    chatId: string,
    cwd: string,
    modelId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<PiSession> => {
    const model = getModel(modelId) ?? modelRegistry.getAvailable()[0]

    if (!model) {
      throw new Error('No Pi model is available. Configure pi CLI auth, then restart Vector.')
    }

    const cached = sessionCache.get(chatId)
    if (cached) {
      if (cached.model?.id !== model.id || cached.model?.provider !== model.provider) {
        await cached.setModel(model)
      }
      cached.setThinkingLevel(thinkingLevel)
      return cached
    }

    const { session } = await createAgentSession({
      cwd,
      model,
      authStorage,
      modelRegistry,
      tools: [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)],
      sessionManager: SessionManager.inMemory()
    })

    session.setThinkingLevel(thinkingLevel)
    sessionCache.set(chatId, session)
    return session
  }

  return {
    metadata: {
      id: PI_PROVIDER_ID,
      name: 'Pi',
      iconSvg: PI_ICON_SVG
    },
    isConfigured: () => true,
    getModels,
    sendMessage: async ({
      chatId,
      cwd,
      prompt,
      images,
      modelId,
      options,
      requestId,
      emit
    }: AgentRequest) => {
      const session = await getOrCreateSession(chatId, cwd, modelId, options.thinkingLevel)
      let text = ''

      emit({ type: 'start', chatId, requestId })

      const unsubscribe = session.subscribe((event: unknown) => {
        const update = event as SessionEvent

        if (update.type === 'message_update') {
          if (update.assistantMessageEvent?.type === 'text_delta') {
            const delta = update.assistantMessageEvent.delta ?? ''
            text += delta
            emit({ type: 'text_delta', chatId, requestId, delta })
          }

          if (update.assistantMessageEvent?.type === 'thinking_delta') {
            emit({
              type: 'thinking_delta',
              chatId,
              requestId,
              delta: update.assistantMessageEvent.delta ?? ''
            })
          }

          return
        }

        if (update.type === 'tool_execution_start') {
          emit({
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
          emit({
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
          emit({
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
        await session.prompt(prompt, images.length > 0 ? { images } : undefined)
        if (!text.trim()) {
          const fallback = extractAssistantText(session.messages as unknown[])
          if (fallback) {
            emit({ type: 'text_delta', chatId, requestId, delta: fallback })
          }
        }
        emit({ type: 'end', chatId, requestId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emit({ type: 'error', chatId, requestId, error: message })
      } finally {
        unsubscribe()
      }
    }
  }
}
