import { createContext, useContext } from 'react'

export interface SystemStatus {
  all_ok?: boolean
  failures?: string[]
  ocr_engine?: string
  components?: Record<string, { ok: boolean; detail: string; balance?: string; message?: string }>
}

export const SystemStatusContext = createContext<SystemStatus | null>(null)

export function useSystemStatus() {
  return useContext(SystemStatusContext)
}
