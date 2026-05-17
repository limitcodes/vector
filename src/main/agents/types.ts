import type { ImageContent } from '@mariozechner/pi-ai'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type AgentProviderOption = {
  id: ThinkingLevel
  label: string
}

export type AgentModel = {
  id: string
  name: string
  providerId: string
  optionGroups: Array<{
    id: 'thinking'
    label: string
    options: AgentProviderOption[]
  }>
}

export type AgentProviderMetadata = {
  id: string
  name: string
  iconSvg: string
}

export type StreamEvent =
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

export type AgentRequest = {
  chatId: string
  cwd: string
  prompt: string
  images: ImageContent[]
  modelId: string
  options: {
    thinkingLevel: ThinkingLevel
  }
  requestId: string
  emit: (event: StreamEvent) => void
}

export interface AgentProvider {
  metadata: AgentProviderMetadata
  isConfigured: () => boolean
  getModels: () => AgentModel[]
  sendMessage: (request: AgentRequest) => Promise<void>
}
