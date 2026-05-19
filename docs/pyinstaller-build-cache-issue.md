# PyInstaller 构建缓存问题

## 问题

多次修改 `backend/engine/pipeline.py` 后运行 PyInstaller 构建，生成的 exe 中代码仍是旧版本。

## 根因

PyInstaller 的 `build/` 目录缓存了编译后的 `.pyc` / PYZ / PKG 等中间产物。默认情况下，PyInstaller 检测到源文件 mtime 变化会重新编译，但某些情况下（特别是快速连续构建）可能复用缓存中的旧产物。

## 复现案例

v1.3.5 迭代中，`--skip-big`、`--optimize 0`、书签前置注入等修改经过 5+ 次构建仍未在新 exe 中生效，用户运行后报 jbig2 crash、书签仍位于 Step 6、无下载按钮。

## 解决方案

**每次修改 Python 源文件后，执行干净构建**：

```powershell
# 删除构建缓存
Remove-Item -Recurse -Force backend\build

# 重新构建
cd backend
python -m PyInstaller --distpath dist --workpath build book-downloader.spec
```

或者在 `build_exe.py` / `release.py` 中构建前自动清理 `build/`。

## 验证方法

构建后直接启动 exe 并调用 API 验证：

```powershell
Stop-Process -Name ebook-pdf-downloader -Force
Start-Process backend\dist\ebook-pdf-downloader.exe
Start-Sleep 3
Invoke-RestMethod http://localhost:8000/api/v1/system-status
```

如仍有疑虑，可对 exe 本身做 smoke test：提交一个测试任务执行完整 Pipeline 并检查日志中 OCR 命令是否包含 `--optimize 0`、书签注入是否出现在 Step 3。
