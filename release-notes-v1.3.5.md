## v1.3.5 (2026-05-20)

### 设置页优化
- 删除 Anna's Archive 会员密钥（stacks 已处理 AA 下载）
- FlareSolverr 精简为状态检测 + 端口配置（移除安装目录、一键安装、启动/停止、Docker 指引）
- 设置页复用启动时系统状态检测（React Context 共享），减少重复 API 请求

### Stacks CORS 修复
- 根因：前端直连 stacks 服务器被浏览器 CORS 拦截
- 修复：添加后端代理端点 /api/v1/check-stacks-health，前端通过后端中转
- 影响：设置页 stacks 自动检测恢复正常，手动"检测"按钮也通过后端代理

### AA 搜索优化
- 搜索 URL 添加 src=duxiu&ext=pdf 限定，仅返回读秀来源 PDF
- MD5 详情页并行化（5页同时请求，串行 75s → 并行 10s）
- 本地数据库搜索移入线程池，不阻塞 async event loop
- Z-Lib 登录重试次数降低（MAX_RETRIES: 3 → 1）

### 其他修复
- 搜索字段映射修正（sscode → ss_code）
- 数据库连接复用（移除每次搜索后 close）
- shutdown 端点保护（referer 检查）
- PDF 下载端点（支持 original/ocr/compressed）
- bw_done 标志修正、BW 备份顺序、DCTDecode 支持
- 删除死代码（LibGen 下载器、重复函数、死变量）
- 类型注解补全（28 个函数）
