import type { Server, Socket } from 'socket.io'
import type {
  PetInfo,
  PetMessage,
  PetAction,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@desktopfriends/shared'

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  onlinePets: Map<string, PetInfo>
) {
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`🐾 Client connected: ${socket.id}`)

    socket.on('pet:register', (info: Omit<PetInfo, 'id' | 'joinedAt'>) => {
      const petInfo: PetInfo = {
        ...info,
        id: socket.id,
        joinedAt: new Date().toISOString(),
      }
      onlinePets.set(socket.id, petInfo)

      io.emit('pet:online', petInfo)
      socket.emit('pets:list', Array.from(onlinePets.values()))

      console.log(`✅ Pet registered: ${info.name} (${socket.id})`)
    })

    socket.on('pet:message', (message: Pick<PetMessage, 'content' | 'to' | 'toName' | 'messageType'>) => {
      const sender = onlinePets.get(socket.id)
      if (!sender) return

      let toName = message.toName
      if (message.to && !toName) {
        toName = onlinePets.get(message.to)?.name
      }

      const baseMessage: PetMessage = {
        content: message.content,
        to: message.to,
        toName,
        messageType: message.messageType,
        from: sender.name,
        fromId: socket.id,
        timestamp: new Date().toISOString(),
      }

      if (message.to) {
        io.sockets.sockets.get(message.to)?.emit('pet:message', {
          ...baseMessage,
          isDirectTarget: true,
        })
      }

      for (const socketId of onlinePets.keys()) {
        if (socketId === socket.id || socketId === message.to) continue
        io.sockets.sockets.get(socketId)?.emit('pet:message', {
          ...baseMessage,
          isDirectTarget: false,
        })
      }

      console.log(`💬 ${sender.name}: ${message.content}`)
    })

    socket.on('pet:action', (action: Omit<PetAction, 'petId' | 'petName'>) => {
      const sender = onlinePets.get(socket.id)
      if (!sender) return

      socket.broadcast.emit('pet:action', {
        ...action,
        petId: socket.id,
        petName: sender.name,
      })
    })

    socket.on('disconnect', (reason) => {
      const pet = onlinePets.get(socket.id)
      if (!pet) return

      onlinePets.delete(socket.id)
      io.emit('pet:offline', socket.id)
      console.log(`👋 Pet disconnected: ${pet.name} (${socket.id}) | reason=${reason}`)
    })
  })
}
