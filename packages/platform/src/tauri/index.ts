import { convertFileSrc } from '@tauri-apps/api/tauri'

export { TauriFilesystem } from './filesystem'
export { TauriWindow } from './window'

export function convertTauriFileSrc(filePath: string, protocol = 'asset'): string {
  return convertFileSrc(filePath, protocol)
}
