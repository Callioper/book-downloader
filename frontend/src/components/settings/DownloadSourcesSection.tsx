import React, { useState, useEffect, useCallback } from 'react'
import { SectionProps } from './types'
import { API_BASE } from '../../constants'
import { useSystemStatus } from '../../contexts/SystemStatusContext'

const STACKS_INSTALL_GUIDE = `## 安装 stacks + FlareSolverr（Docker Compose）

1. 创建目录并进入：
   mkdir ~/stacks && cd ~/stacks

2. 创建 docker-compose.yml：
   notepad docker-compose.yml

3. 粘贴以下内容：

   services:
     stacks:
       image: zelest/stacks:latest
       container_name: stacks
       ports:
         - "7788:7788"
       volumes:
         - ./config:/opt/stacks/config
         - ./download:/opt/stacks/download
         - ./logs:/opt/stacks/logs
       restart: unless-stopped
       environment:
         - USERNAME=admin
         - PASSWORD=stacks
         - TZ=Asia/Shanghai

     flaresolverr:
       image: ghcr.io/flaresolverr/flaresolverr:latest
       container_name: flaresolverr
       ports:
         - "8191:8191"
       environment:
         - LOG_LEVEL=info
       restart: unless-stopped

4. 启动：
   docker compose up -d

5. 访问 http://localhost:7788
   默认密码：admin / stacks

6. 获取 API Key：
   Settings → Authentication → Admin API Key`

function StatusDot({ status }: { status: 'green' | 'red' | 'yellow' | null }) {
  const colors: Record<string, string> = {
    green: 'bg-green-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
  }
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${status ? colors[status] : 'bg-gray-300'}`} />
  )
}

function DownloadSourcesSection({ form, updateForm, mountedRef }: SectionProps) {
  const [zlibChecking, setZlibChecking] = useState(false)
  const [zlibConnected, setZlibConnected] = useState(false)
  const [zlibMsg, setZlibMsg] = useState('')
  const [zlibChecked, setZlibChecked] = useState(false)
  const [zlibBalance, setZlibBalance] = useState('')

  const [flareRunning, setFlareRunning] = useState(false)
  const [flareChecking, setFlareChecking] = useState(true)

  const [stacksStatus, setStacksStatus] = useState<'green' | 'red' | 'yellow' | null>(null)
  const [stacksChecking, setStacksChecking] = useState(false)

  // Sync stacks status from Layout context (avoids redundant CORS health check)
  const systemStatus = useSystemStatus()
  useEffect(() => {
    if (!systemStatus) return
    const ss = systemStatus.components?.stacks
    if (ss !== undefined) {
      setStacksStatus(ss.ok ? 'green' : 'red')
      setStacksChecking(false)
    }
  }, [systemStatus])

  const [proxyChecking, setProxyChecking] = useState(false)
  const [proxyStatus, setProxyStatus] = useState<'green' | 'red' | 'yellow' | null>(null)
  const [proxyMsg, setProxyMsg] = useState('')
  const [proxyChecked, setProxyChecked] = useState(false)
  const [aaProxyStatus, setAaProxyStatus] = useState<'green' | 'red' | 'yellow' | null>(null)
  const [zlProxyStatus, setZlProxyStatus] = useState<'green' | 'red' | 'yellow' | null>(null)
  const [aaProxyDetail, setAaProxyDetail] = useState('')
  const [zlProxyDetail, setZlProxyDetail] = useState('')

  // --- Z-Lib ---
  const handleZlibCheck = useCallback(async () => {
    if (!form.zlib_email || !form.zlib_password) {
      setZlibMsg('请输入邮箱和密码')
      return
    }
    setZlibChecking(true)
    setZlibBalance('')
    setZlibMsg('')
    try {
      const res = await fetch('/api/v1/zlib-fetch-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.zlib_email, password: form.zlib_password }),
      })
      const data = await res.json()
      if (!mountedRef.current) return
      setZlibChecked(true)
      if (data.ok) {
        setZlibConnected(true)
        setZlibMsg('已连接')
        if (data.balance) setZlibBalance(data.balance)
      } else {
        setZlibConnected(false)
        setZlibMsg(data.message || '登录失败')
      }
    } catch (e) {
      if (mountedRef.current) {
        setZlibChecked(true)
        setZlibConnected(false)
        setZlibMsg('请求失败')
      }
    } finally {
      if (mountedRef.current) setZlibChecking(false)
    }
  }, [form.zlib_email, form.zlib_password, mountedRef])

  // ZLib status synced from system-status context

  // --- FlareSolverr ---
  const checkFlare = useCallback(async () => {
    setFlareChecking(true)
    try {
      const res = await fetch('/api/v1/check-flare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_path: '' }),
      })
      const data = await res.json()
      if (!mountedRef.current) return
      setFlareRunning(data.available || false)
    } catch (e) {
      if (mountedRef.current) setFlareRunning(false)
    } finally {
      if (mountedRef.current) setFlareChecking(false)
    }
  }, [mountedRef])

  // FlareSolverr status synced from system-status context

  // --- Proxy ---
  const handleCheckProxy = useCallback(async () => {
    setProxyChecking(true)
    setProxyMsg('')
    try {
      const res = await fetch('/api/v1/check-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ http_proxy: form.http_proxy || '' }),
      })
      const data = await res.json()
      if (!mountedRef.current) return
      setProxyChecked(true)
      if (data.ok) {
        setProxyStatus('green')
        setProxyMsg(data.message || '代理可用')
      } else {
        setProxyStatus('red')
        setProxyMsg(data.message || '代理不可用')
      }
    } catch (e) {
      if (mountedRef.current) {
        setProxyChecked(true)
        setProxyStatus('red')
        setProxyMsg('检测失败')
      }
    } finally {
      if (mountedRef.current) setProxyChecking(false)
    }
  }, [form.http_proxy, mountedRef])

  // Proxy status synced from system-status context

  const handleCheckProxySources = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/check-proxy-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ http_proxy: form.http_proxy || '' }),
      })
      const data = await res.json()
      if (!mountedRef.current) return
      const results = data.results || {}
      const details = data.details || {}
      setAaProxyStatus(results.annas_archive ? 'green' : 'red')
      setZlProxyStatus(results.zlibrary ? 'green' : 'red')
      setAaProxyDetail(details.annas_archive || '')
      setZlProxyDetail(details.zlibrary || '')
    } catch (e) { }
  }, [form.http_proxy, mountedRef])

  // Source connectivity synced from system-status context

  // Stacks status is synced from Layout context above (no CORS auto-detect needed)

  return (
    <div className="space-y-3">
      {/* Z-Library */}
      <div className="border-t border-gray-200 pt-3">
        <span className="text-xs font-medium text-gray-600">Z-Library</span>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <input
            type="text"
            value={form.zlib_email || ''}
            onChange={(e) => updateForm({ zlib_email: e.target.value })}
            placeholder="邮箱"
            spellCheck={false}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            value={form.zlib_password || ''}
            onChange={(e) => updateForm({ zlib_password: e.target.value })}
            placeholder="密码"
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleZlibCheck}
            disabled={zlibChecking}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {zlibChecking ? '登录中...' : '登录'}
          </button>
          {zlibChecking ? (
            <span className="text-xs text-blue-500">登录中...</span>
          ) : zlibChecked && (
            <span className={`text-xs font-medium ${zlibConnected ? 'text-green-600' : 'text-red-500'}`}>
              {zlibConnected ? '已连接' : '未连接'}
            </span>
          )}
          {zlibBalance && (
            <span className="text-xs text-gray-500">{zlibBalance}</span>
          )}
        </div>
        {!zlibChecking && zlibMsg && !zlibConnected && (
          <span className="text-xs text-red-500">{zlibMsg}</span>
        )}
      </div>

      {/* Stacks */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">Stacks（Anna's Archive）</span>
          <StatusDot status={stacksChecking ? 'yellow' : stacksStatus} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form.stacks_base_url || ''}
            onChange={(e) => updateForm({ stacks_base_url: e.target.value })}
            placeholder="http://localhost:7788"
            spellCheck={false}
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={async () => {
              setStacksChecking(true)
              try {
                const url = form.stacks_base_url || 'http://localhost:7788'
                // Proxy through backend to avoid CORS
                const healthRes = await fetch(`${API_BASE}/check-stacks-health?url=${encodeURIComponent(url)}`)
                const hd = await healthRes.json()
                if (!hd.ok) { setStacksStatus('red'); setStacksChecking(false); return }
                const uname = form.stacks_username
                const passwd = form.stacks_password
                if (uname && passwd) {
                  const loginRes = await fetch('/api/v1/check-stacks', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, username: uname, password: passwd }),
                    signal: AbortSignal.timeout(5000),
                  })
                  const ld = await loginRes.json()
                  setStacksStatus(ld.ok ? 'green' : 'yellow')
                } else {
                  setStacksStatus('yellow')
                }
              } catch { setStacksStatus('red') }
              finally { setStacksChecking(false) }
            }}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-600 shrink-0"
          >
            {stacksChecking ? '检测中...' : '检测'}
          </button>
        </div>
        <input
          type="password"
          value={String((form as any).stacks_api_key || '')}
          onChange={(e) => updateForm({ stacks_api_key: e.target.value } as any)}
          placeholder="Admin API Key（可选，填写账号密码后优先使用 session 登录）"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mt-1.5"
        />
        <span className="block text-xs font-medium text-gray-600 mt-2">账户登录</span>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <input
            type="text" value={form.stacks_username || ''}
            onChange={(e) => updateForm({ stacks_username: e.target.value })}
            placeholder="用户名" spellCheck={false}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password" value={form.stacks_password || ''}
            onChange={(e) => updateForm({ stacks_password: e.target.value })}
            placeholder="密码"
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={async () => {
              setStacksChecking(true)
              try {
                const res = await fetch('/api/v1/check-stacks', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: form.stacks_base_url || 'http://localhost:7788', username: form.stacks_username || '', password: form.stacks_password || '' }),
                  signal: AbortSignal.timeout(5000),
                })
                const d = await res.json()
                setStacksStatus(d.ok ? 'green' : 'red')
              } catch { setStacksStatus('red') }
              finally { setStacksChecking(false) }
            }}
            disabled={stacksChecking}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {stacksChecking ? '登录中...' : '登录'}
          </button>
          {!stacksChecking && stacksStatus === 'green' && (
            <span className="text-xs font-medium text-green-600">已连接</span>
          )}
          {!stacksChecking && stacksStatus === 'red' && (
            <span className="text-xs font-medium text-red-500">未连接</span>
          )}
          {!stacksChecking && stacksStatus === 'yellow' && (
            <span className="text-xs text-gray-500">需要登录</span>
          )}
        </div>
        <details className="mt-2">
          <summary className="text-xs font-medium text-gray-600 cursor-pointer list-none flex items-center gap-1 select-none hover:text-gray-800">
            <svg className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            stacks 安装指引
          </summary>
          <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-3">
            <p className="text-xs text-blue-800 font-medium mb-2">📋 将以下提示词复制并发送给 OpenCode：</p>
            <pre className="text-xs text-blue-700 bg-blue-100 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">{STACKS_INSTALL_GUIDE}</pre>
            <p className="text-xs text-blue-600 mt-2">安装并启动后，点击"检测"确认连接状态。</p>
          </div>
        </details>
      </div>

      {/* FlareSolverr */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">FlareSolverr</span>
          <StatusDot status={flareChecking ? 'yellow' : flareRunning ? 'green' : 'red'} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">
            {flareRunning ? '运行中' : '未检测到'}
          </span>
          <button
            type="button"
            onClick={() => checkFlare()}
            disabled={flareChecking}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-600 disabled:opacity-50"
          >
            {flareChecking ? '检测中...' : '重新检测'}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="number"
            value={Number((form as any).flaresolverr_port) || 8191}
            onChange={(e) => updateForm({ flaresolverr_port: parseInt(e.target.value) || 8191 } as any)}
            placeholder="端口号"
            min={1}
            max={65535}
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">FlareSolverr 端口（默认 8191）</span>
        </div>
      </div>

      {/* PDF 压缩 */}
      <div className="border-t border-gray-200 pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!(form as any).pdf_compress}
            onChange={(e) => updateForm({ pdf_compress: e.target.checked } as any)}
            className="rounded border-gray-300"
          />
          <span className="text-xs font-medium text-gray-600">PDF 黑白二值化压缩（OCR 后执行）</span>
        </label>
        <p className="text-xs text-gray-400 mt-0.5 ml-5">将彩色扫描页转为 1-bit 黑白，大幅减小体积，完整保留 OCR 文字层。</p>
        {(form as any).pdf_compress && (
          <div className="mt-2 ml-5 flex items-center gap-3">
            <span className="text-xs text-gray-500">分辨率:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="pdf_compress_half"
                checked={!(form as any).pdf_compress_half}
                onChange={() => updateForm({ pdf_compress_half: false } as any)}
                className="border-gray-300"
              />
              <span className="text-xs text-gray-600">全分辨率 (~300 DPI)</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="pdf_compress_half"
                checked={!!(form as any).pdf_compress_half}
                onChange={() => updateForm({ pdf_compress_half: true } as any)}
                className="border-gray-300"
              />
              <span className="text-xs text-gray-600">半分辨率 (~150 DPI, 体积更小)</span>
            </label>
          </div>
        )}
      </div>

      {/* ============ 网络代理 ============ */}
      <div className="border-t border-gray-200 pt-3">
        <span className="text-xs font-medium text-gray-600">HTTP 代理</span>
        <div className="mt-1">
          <label className="block text-xs text-gray-500 mb-1">HTTP 代理地址（可选）</label>
          <input
            type="text"
            value={form.http_proxy || ''}
            onChange={(e) => updateForm({ http_proxy: e.target.value })}
            placeholder="http://127.0.0.1:10809"
            spellCheck={false}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleCheckProxy}
            disabled={proxyChecking}
            className="px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {proxyChecking ? '检测中...' : '检测'}
          </button>
          {proxyChecking ? (
            <span className="text-xs text-purple-500">检测中...</span>
          ) : proxyChecked ? (
            <>
              <StatusDot status={proxyStatus} />
              {proxyStatus === 'green' && (
                <span className="text-xs text-green-600 font-medium">已连接</span>
              )}
              {!proxyStatus && <span className="text-xs text-red-500">{proxyMsg}</span>}
            </>
          ) : (
            <StatusDot status={proxyStatus} />
          )}
        </div>
      </div>

      {/* 源站连通性 */}
      <div className="border-t border-gray-200 pt-3">
        <span className="text-xs font-medium text-gray-600">源站连通性</span>
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5">
            <StatusDot status={aaProxyStatus} />
            <span className="text-xs text-gray-500">Anna's Archive</span>
            {aaProxyDetail && <span className="text-xs text-gray-400">({aaProxyDetail})</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status={zlProxyStatus} />
            <span className="text-xs text-gray-500">Z-Library</span>
            {zlProxyDetail && <span className="text-xs text-gray-400">({zlProxyDetail})</span>}
          </div>
          <button
            type="button"
            onClick={handleCheckProxySources}
            className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-500"
          >
            检测
          </button>
        </div>
      </div>
    </div>
  )
}

export default React.memo(DownloadSourcesSection)
