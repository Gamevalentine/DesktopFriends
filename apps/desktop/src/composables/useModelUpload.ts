import { ref } from 'vue'
import { open } from '@tauri-apps/api/dialog'
import {
  createDir,
  readDir,
  readBinaryFile,
  writeBinaryFile,
  writeTextFile,
  removeDir,
} from '@tauri-apps/api/fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import JSZip from 'jszip'

export interface UploadProgress {
  stage: 'reading' | 'extracting' | 'saving' | 'done' | 'error'
  progress: number
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface MotionGroupInfo {
  group: string
  count: number
}

export interface ModelUploadInfo {
  modelName: string
  expressionCount: number
  motionGroups: MotionGroupInfo[]
  textureCount: number
  totalFiles: number
}

export interface UploadResult {
  path: string
  info: ModelUploadInfo
}

interface ModelCandidate {
  path: string
  content: string
}

const normalizeArchivePath = (path: string): string | null => {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return null
  }

  const parts: string[] = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' || part.includes('\0')) return null
    parts.push(part)
  }

  return parts.length > 0 ? parts.join('/') : null
}

const resolveArchiveReference = (baseDir: string, reference: string): string | null => {
  const ref = reference.replace(/\\/g, '/')
  if (!ref || ref.startsWith('/') || /^[a-zA-Z]:\//.test(ref)) return null

  const parts = baseDir ? baseDir.split('/').filter(Boolean) : []
  for (const part of ref.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    if (part.includes('\0')) return null
    parts.push(part)
  }

  return parts.length > 0 ? parts.join('/') : null
}

const getRequiredModelReferences = (jsonContent: string): string[] => {
  try {
    const modelData = JSON.parse(jsonContent)

    if (modelData.FileReferences) {
      const refs = modelData.FileReferences
      const required: string[] = []
      if (typeof refs.Moc === 'string') required.push(refs.Moc)
      if (Array.isArray(refs.Textures)) {
        required.push(...refs.Textures.filter((item: unknown): item is string => typeof item === 'string'))
      }
      return required
    }

    const required: string[] = []
    if (typeof modelData.model === 'string') required.push(modelData.model)
    if (Array.isArray(modelData.textures)) {
      required.push(...modelData.textures.filter((item: unknown): item is string => typeof item === 'string'))
    }
    return required
  } catch {
    return []
  }
}

const validateZipStructure = (zip: JSZip): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []
  const fileEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir)
  const safeFiles = fileEntries
    .map(([path]) => normalizeArchivePath(path))
    .filter((f): f is string => Boolean(f))

  if (safeFiles.length !== fileEntries.length) {
    errors.push('压缩包包含不安全或无效的文件路径')
  }

  const hasModelJson = safeFiles.some(
    (f) => f.toLowerCase().endsWith('.model3.json') || f.toLowerCase().endsWith('.model.json')
  )
  if (!hasModelJson) {
    errors.push('缺少模型配置文件 (.model3.json 或 .model.json)')
  }

  const hasMoc = safeFiles.some(
    (f) => f.toLowerCase().endsWith('.moc3') || f.toLowerCase().endsWith('.moc')
  )
  if (!hasMoc) {
    errors.push('缺少模型数据文件 (.moc3 或 .moc)')
  }

  const hasTexture = safeFiles.some(
    (f) => f.toLowerCase().endsWith('.png') && !f.toLowerCase().includes('__macosx')
  )
  if (!hasTexture) {
    errors.push('缺少纹理文件 (.png)')
  }

  const hasMotion = safeFiles.some(
    (f) => f.toLowerCase().endsWith('.motion3.json') || f.toLowerCase().endsWith('.motion.json')
  )
  if (!hasMotion) {
    warnings.push('未找到动作文件，模型可能无法播放动作')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

const findUsableModel = async (zip: JSZip): Promise<ModelCandidate | null> => {
  const candidates: Array<{ path: string; entry: JSZip.JSZipObject }> = []

  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const path = normalizeArchivePath(rawPath)
    if (!path) continue
    const lower = path.toLowerCase()
    if (lower.endsWith('.model3.json') || lower.endsWith('.model.json')) {
      candidates.push({ path, entry })
    }
  }

  candidates.sort((a, b) => {
    const depthDiff = a.path.split('/').length - b.path.split('/').length
    return depthDiff !== 0 ? depthDiff : a.path.length - b.path.length
  })

  const available = new Set(
    Object.keys(zip.files)
      .filter((rawPath) => !zip.files[rawPath].dir)
      .map(normalizeArchivePath)
      .filter((path): path is string => Boolean(path))
  )

  for (const candidate of candidates) {
    const content = await candidate.entry.async('string')
    const baseDir = candidate.path.includes('/')
      ? candidate.path.substring(0, candidate.path.lastIndexOf('/'))
      : ''
    const requiredRefs = getRequiredModelReferences(content)

    if (requiredRefs.length === 0) continue
    const allRequiredFilesExist = requiredRefs.every((reference) => {
      const resolved = resolveArchiveReference(baseDir, reference)
      return resolved !== null && available.has(resolved)
    })

    if (allRequiredFilesExist) {
      return { path: candidate.path, content }
    }
  }

  return null
}

export function useModelUpload() {
  const isUploading = ref(false)
  const uploadProgress = ref<UploadProgress>({
    stage: 'reading',
    progress: 0,
    message: '',
  })
  const error = ref<string | null>(null)

  const updateProgress = (stage: UploadProgress['stage'], progress: number, message: string) => {
    uploadProgress.value = { stage, progress, message }
  }

  const selectModelFile = async (): Promise<string | null> => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Live2D Model',
            extensions: ['zip'],
          },
        ],
      })

      return typeof selected === 'string' ? selected : null
    } catch (e) {
      console.error('File selection error:', e)
      return null
    }
  }

  const uploadModel = async (filePath: string, modelName: string): Promise<UploadResult | null> => {
    if (!filePath.toLowerCase().endsWith('.zip')) {
      error.value = '请选择 zip 格式的模型文件'
      return null
    }

    isUploading.value = true
    error.value = null

    try {
      updateProgress('reading', 10, '正在读取文件...')
      const fileData = await readBinaryFile(filePath)

      updateProgress('extracting', 30, '正在解压模型...')
      const zip = await JSZip.loadAsync(fileData.buffer)

      const validation = validateZipStructure(zip)
      if (!validation.valid) {
        throw new Error(
          '压缩包格式不符合要求：\n' +
            validation.errors.join('\n') +
            '\n\n请确保压缩包包含完整且安全的 Live2D 模型文件。'
        )
      }

      const candidate = await findUsableModel(zip)
      if (!candidate) {
        throw new Error('未找到引用完整的模型文件，请检查 moc/moc3 与纹理是否齐全')
      }

      const modelJsonPath = candidate.path
      const modelJsonContent = candidate.content
      const modelInfo = parseModelJson(modelJsonContent, modelName)
      const modelDir = modelJsonPath.includes('/')
        ? modelJsonPath.substring(0, modelJsonPath.lastIndexOf('/'))
        : ''

      const safeModelName =
        modelName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_').replace(/^_+|_+$/g, '') ||
        `model_${Date.now()}`

      const appData = await appDataDir()
      const modelsDir = await join(appData, 'models')
      const targetDir = await join(modelsDir, safeModelName)

      updateProgress('saving', 50, '正在保存模型文件...')
      await createDir(modelsDir, { recursive: true })
      await createDir(targetDir, { recursive: true })

      const files = Object.keys(zip.files)
      let savedCount = 0
      let eligibleCount = 0

      for (const rawPath of files) {
        const zipEntry = zip.files[rawPath]
        if (zipEntry.dir) continue

        const safePath = normalizeArchivePath(rawPath)
        if (!safePath) continue

        if (modelDir && safePath !== modelJsonPath && !safePath.startsWith(`${modelDir}/`)) {
          continue
        }

        eligibleCount++
        const relativePath = modelDir ? safePath.substring(modelDir.length + 1) : safePath
        if (!relativePath) continue

        const targetPath = await join(targetDir, relativePath)
        const lastSlashIndex = relativePath.lastIndexOf('/')
        if (lastSlashIndex > 0) {
          const parentPath = await join(targetDir, relativePath.substring(0, lastSlashIndex))
          await createDir(parentPath, { recursive: true })
        }

        const isTextFile = /\.(json|txt|html|css|js|xml)$/i.test(relativePath)
        if (isTextFile) {
          await writeTextFile(targetPath, await zipEntry.async('string'))
        } else {
          await writeBinaryFile(targetPath, await zipEntry.async('uint8array'))
        }

        savedCount++
        const progressBase = Math.max(eligibleCount, 1)
        const progress = 50 + Math.min(40, Math.floor((savedCount / progressBase) * 40))
        updateProgress('saving', progress, `正在保存文件 (${savedCount})...`)
      }

      modelInfo.totalFiles = savedCount
      const modelFileName = modelJsonPath.substring(modelJsonPath.lastIndexOf('/') + 1)
      const resultPath = await join(targetDir, modelFileName)

      updateProgress('done', 100, '模型上传成功！')
      return {
        path: resultPath,
        info: modelInfo,
      }
    } catch (e) {
      console.error('Model upload error:', e)
      error.value = e instanceof Error ? e.message : '上传失败'
      updateProgress('error', 0, error.value)
      return null
    } finally {
      isUploading.value = false
    }
  }

  const getUploadedModels = async (): Promise<string[]> => {
    try {
      const appData = await appDataDir()
      const modelsDir = await join(appData, 'models')
      const result = await readDir(modelsDir)
      return result.filter((f) => f.children !== undefined).map((f) => f.name || '')
    } catch {
      return []
    }
  }

  const getModelPath = async (modelName: string): Promise<string | null> => {
    try {
      const appData = await appDataDir()
      const modelDir = await join(appData, 'models', modelName)
      const files = await readDir(modelDir)

      for (const file of files) {
        const fileName = file.name?.toLowerCase() || ''
        if (fileName.endsWith('.model3.json') || fileName.endsWith('.model.json')) {
          return await join(modelDir, file.name || '')
        }
      }

      return null
    } catch {
      return null
    }
  }

  const deleteModel = async (modelName: string): Promise<boolean> => {
    try {
      const appData = await appDataDir()
      const modelDir = await join(appData, 'models', modelName)
      await removeDir(modelDir, { recursive: true })
      return true
    } catch (e) {
      console.error('Delete model error:', e)
      return false
    }
  }

  const parseModelJson = (jsonContent: string, modelName: string): ModelUploadInfo => {
    const info: ModelUploadInfo = {
      modelName,
      expressionCount: 0,
      motionGroups: [],
      textureCount: 0,
      totalFiles: 0,
    }

    try {
      const modelData = JSON.parse(jsonContent)

      if (modelData.FileReferences) {
        const fileRefs = modelData.FileReferences

        if (Array.isArray(fileRefs.Expressions)) {
          info.expressionCount = fileRefs.Expressions.length
        }

        if (fileRefs.Motions) {
          for (const [groupName, motions] of Object.entries(fileRefs.Motions)) {
            if (Array.isArray(motions)) {
              info.motionGroups.push({ group: groupName, count: motions.length })
            }
          }
        }

        if (Array.isArray(fileRefs.Textures)) {
          info.textureCount = fileRefs.Textures.length
        }
      } else {
        if (Array.isArray(modelData.expressions)) {
          info.expressionCount = modelData.expressions.length
        }

        if (modelData.motions) {
          for (const [groupName, motions] of Object.entries(modelData.motions)) {
            if (Array.isArray(motions)) {
              info.motionGroups.push({ group: groupName, count: motions.length })
            }
          }
        }

        if (Array.isArray(modelData.textures)) {
          info.textureCount = modelData.textures.length
        }
      }
    } catch (e) {
      console.warn('Failed to parse model JSON for info:', e)
    }

    return info
  }

  return {
    isUploading,
    uploadProgress,
    error,
    selectModelFile,
    uploadModel,
    getUploadedModels,
    getModelPath,
    deleteModel,
  }
}
