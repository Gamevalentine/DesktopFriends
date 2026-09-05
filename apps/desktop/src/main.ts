import './desktopBootstrap'
import { createApp } from 'vue'
import App from './App.vue'
import ChatHistoryWindow from './views/ChatHistoryWindow.vue'
import WidgetWindow from './views/WidgetWindow.vue'

// 导入 UI 组件库样式
import '@desktopfriends/ui/style.css'

const view = new URLSearchParams(window.location.search).get('view')
const RootComponent =
  view === 'chat-history'
    ? ChatHistoryWindow
    : view === 'widget'
      ? WidgetWindow
      : App

const app = createApp(RootComponent)
app.mount('#app')
