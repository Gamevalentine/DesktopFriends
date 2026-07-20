import { beforeEach, describe, expect, it } from 'vitest'
import { setupSocketHandlers } from './socket.js'
import type { PetInfo } from '@desktopfriends/shared'

type Handler = (...args: any[]) => void

class FakeSocket {
  readonly handlers = new Map<string, Handler>()
  readonly emitted: Array<{ event: string; args: any[] }> = []
  readonly data: Record<string, unknown> = {}
  readonly broadcast = {
    emit: (event: string, ...args: any[]) => {
      this.serverEmits.push({ event, args })
    },
  }

  constructor(
    readonly id: string,
    private readonly serverEmits: Array<{ event: string; args: any[] }>,
  ) {}

  on(event: string, handler: Handler) {
    this.handlers.set(event, handler)
    return this
  }

  emit(event: string, ...args: any[]) {
    this.emitted.push({ event, args })
    return true
  }

  trigger(event: string, ...args: any[]) {
    this.handlers.get(event)?.(...args)
  }
}

class FakeServer {
  readonly emitted: Array<{ event: string; args: any[] }> = []
  readonly sockets = {
    sockets: new Map<string, FakeSocket>(),
  }
  private connectionHandler: Handler | null = null

  on(event: string, handler: Handler) {
    if (event === 'connection') {
      this.connectionHandler = handler
    }
    return this
  }

  emit(event: string, ...args: any[]) {
    this.emitted.push({ event, args })
    return true
  }

  connect(id: string) {
    const socket = new FakeSocket(id, this.emitted)
    this.sockets.sockets.set(id, socket)
    this.connectionHandler?.(socket)
    return socket
  }
}

describe('pet relay', () => {
  let server: FakeServer
  let onlinePets: Map<string, PetInfo>

  beforeEach(() => {
    server = new FakeServer()
    onlinePets = new Map()
    setupSocketHandlers(server as any, onlinePets)
  })

  it('accepts and registers ordinary pet clients without bridge credentials', () => {
    const alice = server.connect('alice-id')

    alice.trigger('pet:register', { name: 'Alice' })

    expect(onlinePets.get('alice-id')).toMatchObject({
      id: 'alice-id',
      name: 'Alice',
    })
    expect(alice.emitted.some(({ event }) => event === 'pets:list')).toBe(true)
  })

  it('routes direct pet messages to the selected recipient', () => {
    const alice = server.connect('alice-id')
    const bob = server.connect('bob-id')
    alice.trigger('pet:register', { name: 'Alice' })
    bob.trigger('pet:register', { name: 'Bob' })

    alice.trigger('pet:message', {
      content: 'hello',
      to: 'bob-id',
      toName: 'Bob',
      messageType: 'pet_to_pet',
    })

    const messageEvent = bob.emitted.find(({ event }) => event === 'pet:message')
    expect(messageEvent?.args[0]).toMatchObject({
      content: 'hello',
      from: 'Alice',
      to: 'bob-id',
      isDirectTarget: true,
    })
  })
})
