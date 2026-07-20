import BonjourService from 'bonjour-service'
import type { Service } from 'bonjour-service'
import os from 'os'

const Bonjour = (BonjourService as any).default || BonjourService

let bonjour: any = null
let publishedService: Service | null = null

interface RemoteService {
  name: string
  host: string
  port: number
  txt?: Record<string, string>
}

export interface DesktopFriendsServiceMetadata {
  version: string
  ip: string
  port: number
  hostname: string
}

export function getLocalIP(): string {
  const interfaces = os.networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.internal || iface.family !== 'IPv4') continue
      if (
        iface.address.startsWith('192.168.') ||
        iface.address.startsWith('10.') ||
        iface.address.startsWith('172.')
      ) {
        return iface.address
      }
    }
  }

  return '127.0.0.1'
}

export function publishService(port: number, name?: string): Service | null {
  bonjour = new Bonjour()

  const serviceName = name || `DesktopFriends-${os.hostname()}`
  const localIP = getLocalIP()

  publishedService = bonjour.publish({
    name: serviceName,
    type: 'desktopfriends',
    port,
    txt: {
      version: '1.0',
      ip: localIP,
      port: String(port),
      hostname: os.hostname(),
    },
  })

  console.log(`📡 mDNS service published: ${serviceName}._desktopfriends._tcp`)
  console.log(`   Local IP: ${localIP}:${port}`)

  return publishedService
}

export function discoverServices(
  onFound: (service: {
    name: string
    host: string
    port: number
    ip?: string
    metadata?: DesktopFriendsServiceMetadata
  }) => void,
  onRemoved?: (service: { name: string }) => void,
): () => void {
  if (!bonjour) {
    bonjour = new Bonjour()
  }

  const browser = bonjour.find({ type: 'desktopfriends' })

  browser.on('up', (service: RemoteService) => {
    const metadata: DesktopFriendsServiceMetadata | undefined = service.txt
      ? {
          version: service.txt.version || '1.0',
          ip: service.txt.ip || service.host,
          port: Number(service.txt.port || service.port),
          hostname: service.txt.hostname || service.name,
        }
      : undefined

    onFound({
      name: service.name,
      host: service.host,
      port: service.port,
      ip: metadata?.ip,
      metadata,
    })
  })

  if (onRemoved) {
    browser.on('down', (service: RemoteService) => {
      onRemoved({ name: service.name })
    })
  }

  return () => browser.stop()
}

export function unpublishService(): void {
  if (publishedService) {
    publishedService.stop?.()
    publishedService = null
  }
  if (bonjour) {
    bonjour.destroy()
    bonjour = null
  }
  console.log('📡 mDNS service unpublished')
}
