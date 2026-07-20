import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Server } from 'socket.io'
import { setupSocketHandlers } from './socket.js'
import { publishService, unpublishService, getLocalIP } from './mdns.js'
import type { PetInfo, ServerToClientEvents, ClientToServerEvents } from '@desktopfriends/shared'

const DEFAULT_PORT = Number(process.env.PORT) || 3000
const MAX_PORT_ATTEMPTS = 10
const HOST = process.env.HOST || '0.0.0.0'

const fastify = Fastify({ logger: true })

await fastify.register(cors, {
  origin: true,
})

const io = new Server<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

const onlinePets = new Map<string, PetInfo>()
setupSocketHandlers(io, onlinePets)

let actualPort = DEFAULT_PORT

fastify.get('/health', async () => {
  return { status: 'ok', pets: onlinePets.size }
})

fastify.get('/pets', async () => {
  return Array.from(onlinePets.values())
})

fastify.get('/info', async () => {
  return {
    name: 'DesktopFriends Server',
    version: '1.0',
    ip: getLocalIP(),
    port: actualPort,
    pets: onlinePets.size,
  }
})

async function tryListen(port: number, attempts: number = 0): Promise<number> {
  if (attempts >= MAX_PORT_ATTEMPTS) {
    throw new Error(`无法找到可用端口 (尝试了 ${DEFAULT_PORT} - ${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1})`)
  }

  try {
    await fastify.listen({ port, host: HOST })
    return port
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') {
      console.log(`⚠️  端口 ${port} 已被占用，尝试端口 ${port + 1}...`)
      return tryListen(port + 1, attempts + 1)
    }
    throw err
  }
}

const start = async () => {
  try {
    actualPort = await tryListen(DEFAULT_PORT)
    console.log(`🚀 DesktopFriends relay server running at http://${HOST}:${actualPort}`)
    console.log('📡 Socket.io ready for pet connections')
    publishService(actualPort)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 收到 ${signal}，正在关闭服务...`)

  try {
    unpublishService()
    io.close()
    await fastify.close()
    console.log('✅ 服务已安全关闭')
    process.exit(0)
  } catch (err) {
    console.error('❌ 关闭时发生错误:', err)
    process.exit(1)
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获的异常:', err)
  gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  console.error('❌ 未处理的 Promise 拒绝:', reason)
})

start()
