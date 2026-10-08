import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/jetbrains-mono'
import './styles/main.css'
import { App } from './App'

const app = new App()
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  ;(window as unknown as { __app: App }).__app = app
}
app.boot().catch((err) => {
  console.error(err)
  // never leave the visitor stuck on the loader
  document.body.classList.remove('is-loading')
  document.getElementById('loader')?.remove()
})
