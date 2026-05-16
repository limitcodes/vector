import './assets/main.css'
import '@mariozechner/mini-lit/dist/MarkdownBlock.js'
import '@xterm/xterm/css/xterm.css'

import { render } from 'lit'
import {
  App,
  setAppChangeListener,
  setChatNotificationCleanup,
  setStreamCleanup,
  setTerminalCleanup
} from './App'

document.documentElement.classList.add('dark')

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root container not found')
}

const mount = (): void => {
  render(App(), container)
}

setAppChangeListener(mount)
setStreamCleanup(window.api.onAgentStreamEvent)
setChatNotificationCleanup(window.api.onChatNotificationClick)
setTerminalCleanup(window.api.onTerminalEvent)
mount()
