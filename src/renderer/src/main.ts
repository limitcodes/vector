import './assets/main.css'
import '@mariozechner/mini-lit/dist/MarkdownBlock.js'

import { render } from 'lit'
import { App, setAppChangeListener, setStreamCleanup } from './App'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root container not found')
}

const mount = (): void => {
  render(App(), container)
}

setAppChangeListener(mount)
setStreamCleanup(window.api.onAgentStreamEvent)
mount()
