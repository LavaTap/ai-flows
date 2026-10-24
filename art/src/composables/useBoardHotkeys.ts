import { onBeforeUnmount, onMounted } from 'vue'
import type { CanvasEngine } from '@/core/canvas/CanvasEngine'
import type { ToolName } from '@/types/board'

const TOOL_KEYS: Record<string, ToolName> = {
  v: 'select',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
  p: 'pen',
  e: 'eraser',
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

interface HotkeyOptions {
  save: () => void
}

/** 画布快捷键：工具切换、删除、复制、撤销重做、缩放与空格平移 */
export function useBoardHotkeys(
  getEngine: () => CanvasEngine | null,
  options: HotkeyOptions,
): void {
  function onKeyDown(event: KeyboardEvent): void {
    const engine = getEngine()
    if (!engine) return

    if (event.key === ' ' && !isEditable(event.target)) {
      event.preventDefault()
      engine.setSpacePressed(true)
      return
    }

    if (isEditable(event.target)) return

    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (mod) {
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) engine.redo()
        else engine.undo()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        engine.redo()
        return
      }
      if (key === 's') {
        event.preventDefault()
        options.save()
        return
      }
      if (key === 'd') {
        event.preventDefault()
        void engine.duplicateSelection()
        return
      }
      if (key === '0') {
        event.preventDefault()
        engine.resetView()
        return
      }
      if (key === '1') {
        event.preventDefault()
        engine.fitContent()
        return
      }
      if (key === '=' || key === '+') {
        event.preventDefault()
        engine.zoomIn()
        return
      }
      if (key === '-') {
        event.preventDefault()
        engine.zoomOut()
        return
      }
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      engine.deleteSelection()
      return
    }

    if (event.key === 'Escape') {
      engine.setTool('select')
      engine.clearSelection()
      return
    }

    if (!mod) {
      const tool = TOOL_KEYS[key]
      if (tool) {
        event.preventDefault()
        engine.setTool(tool)
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') getEngine()?.setSpacePressed(false)
  }

  function onBlur(): void {
    getEngine()?.setSpacePressed(false)
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  })
}
