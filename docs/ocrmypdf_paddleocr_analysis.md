# ocrmypdf_paddleocr 插件源码与使用逻辑分析

> 版本: 0.1.1 | 许可证: MPL-2.0 | Python >= 3.11
> 
> 项目路径: `D:\opencode\book-downloader`

---

## 目录

1. [整体架构与数据流](#1-整体架构与数据流)
2. [插件源码 (3 个文件)](#2-插件源码)
3. [主进程集成代码 (pipeline.py)](#3-主进程集成代码)
4. [实时进度反馈机制](#4-实时进度反馈机制)
5. [安装与检测逻辑 (search.py)](#5-安装与检测逻辑)
6. [完整调用链路图](#6-完整调用链路图)

---

## 1. 整体架构与数据流

```
                          ┌──────────────────────────────────────────────┐
                          │            book-downloader 主进程             │
                          │         (Python 3.14 + PyInstaller exe)       │
                          │                                              │
pipeline.py:2342 ──────► │  _run_ocrmypdf_with_progress(task_id, cmd)    │
                          │       │                                      │
                          │       ▼  asyncio.create_subprocess_exec       │
                          │  ┌──────────────────────────────────────┐    │
                          │  │  venv-paddle311\python.exe            │    │
                          │  │    -m ocrmypdf                        │    │
                          │  │    --plugin ocrmypdf_paddleocr        │    │
                          │  │    input.pdf -o output_ocr.pdf        │    │
                          │  │         │                            │    │
                          │  │         ▼  pluggy hook dispatch       │    │
                          │  │  ┌─────────────────────────────────┐ │    │
                          │  │  │  ocrmypdf_paddleocr 插件         │ │    │
                          │  │  │  __init__.py: hooks注册          │ │    │
                          │  │  │  engine.py: PaddleOcrEngine      │ │    │
                          │  │  │  lang_map.py: 语言代码映射       │ │    │
                          │  │  └──────────┬──────────────────────┘ │    │
                          │  │             │ stderr: [1] [2] [3]... │    │
                          │  └─────────────┼───────────────────────┘    │
                          │                │                            │
                          │       ◄────────┘  stdout + stderr 合并 PIPE │
                          │       │  _reader() 逐行异步读取              │
                          │       │  regex 解析进度  → 日志 + WebSocket  │
                          └───────┼──────────────────────────────────────┘
                                  ▼
                         前端 TaskDetail 面板: "PaddleOCR: 1/217 页"
```

---

## 2. 插件源码

插件位于 venv 内部的 site-packages，共 3 个 Python 文件。

### 2.1 目录结构

```
venv-paddle311\Lib\site-packages\ocrmypdf_paddleocr\
├── __init__.py      # hooks 注册入口
├── engine.py        # PaddleOcrEngine 实现
└── lang_map.py      # Tesseract → PaddleOCR 语言代码映射
```

---

### 2.2 `__init__.py` —— 插件入口与 hooks

**路径:** `venv-paddle311\Lib\site-packages\ocrmypdf_paddleocr\__init__.py`

```python
# SPDX-License-Identifier: MPL-2.0

"""PaddleOCR engine plugin for OCRmyPDF."""

from __future__ import annotations

import logging

from ocrmypdf import hookimpl

log = logging.getLogger(__name__)


@hookimpl
def initialize(plugin_manager):
    """Check that PaddleOCR is importable at startup."""
    try:
        import paddleocr  # noqa: F401
    except ImportError:
        from ocrmypdf.exceptions import MissingDependencyError

        raise MissingDependencyError(
            "PaddleOCR is required but not installed. "
            "Install with: pip install paddleocr paddlepaddle"
        )


@hookimpl
def check_options(options):
    """Limit concurrency -- PaddlePaddle's inference crashes with multiple workers."""
    if options.jobs != 1:
        log.info("PaddleOCR: forcing jobs=1 (PaddlePaddle is not multi-process safe)")
        options.jobs = 1


@hookimpl
def get_ocr_engine():
    """Return PaddleOcrEngine."""
    from ocrmypdf_paddleocr.engine import PaddleOcrEngine

    return PaddleOcrEngine()
```

**三个 ocrmypdf hook:**

| Hook | 触发时机 | 作用 |
|------|---------|------|
| `initialize()` | 插件加载时 | 检测 paddleocr 是否可导入，不可用则抛出 MissingDependencyError |
| `check_options()` | 参数解析后 | **强制 `jobs=1`**：PaddlePaddle 内部已使用所有 CPU 核心，多进程只会争抢资源 |
| `get_ocr_engine()` | 每次 OCR 调用 | 返回 `PaddleOcrEngine` 实例 |

---

### 2.3 `engine.py` —— PaddleOcrEngine 核心实现

**路径:** `venv-paddle311\Lib\site-packages\ocrmypdf_paddleocr\engine.py`

#### 2.3.1 引擎缓存管理

```python
_paddle_engine = None   # 全局缓存的 PaddleOCR 实例
_paddle_lang = None     # 当前缓存的语言


def _create_paddle_engine(lang: str):
    """Create a new PaddleOCR engine instance."""
    # Tesseract 的插件会设置 OMP_THREAD_LIMIT=1，这会严重限制 PaddlePaddle
    saved = os.environ.pop('OMP_THREAD_LIMIT', None)

    from paddleocr import PaddleOCR

    engine = PaddleOCR(
        lang=lang,
        use_doc_orientation_classify=False,   # 文档方向分类：关闭
        use_doc_unwarping=False,              # 文档展平：关闭
        use_textline_orientation=True,        # 文本行方向检测：开启
    )

    if saved is not None:
        os.environ['OMP_THREAD_LIMIT'] = saved

    return engine


def _get_paddle_engine(options: OcrOptions):
    """获取或创建缓存的 PaddleOCR 引擎实例（语言变更时重建）"""
    global _paddle_engine, _paddle_lang

    lang = tesseract_to_paddle(options.languages[0]) if options.languages else 'en'

    if _paddle_engine is not None and _paddle_lang == lang:
        return _paddle_engine     # 命中缓存

    _paddle_engine = _create_paddle_engine(lang)
    _paddle_lang = lang
    return _paddle_engine


def _reset_paddle_engine():
    """强制重建引擎（用于 C++ 预测器在被 ThreadPoolExecutor 重用后变脏时）"""
    global _paddle_engine, _paddle_lang
    _paddle_engine = None
    _paddle_lang = None
```

**关键设计：**
- 全局单例缓存，语言不变时复用引擎（避免每次加载模型）
- 移除 `OMP_THREAD_LIMIT` 环境变量（Tesseract 插件会设为 1，但 PaddlePaddle 需要多核）
- 引擎参数：关闭方向分类和文档展平（由 ocrmypdf 负责），开启文本行方向检测

#### 2.3.2 坐标转换工具

```python
def _quad_to_bbox(quad) -> BoundingBox | None:
    """将 PaddleOCR 的 4 点 quad 转换为 ocrmypdf 的 BoundingBox"""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    left, right = float(min(xs)), float(max(xs))
    top, bottom = float(min(ys)), float(max(ys))
    if right <= left or bottom <= top:
        return None
    return BoundingBox(left=left, top=top, right=right, bottom=bottom)
```

#### 2.3.3 `PaddleOcrEngine` 类 —— 实现 OCRmyPDF 的 `OcrEngine` 接口

```python
class PaddleOcrEngine(OcrEngine):
    """OCR engine using PaddleOCR."""

    # ── 元信息 ──

    @staticmethod
    def version() -> str:
        import paddleocr
        return getattr(paddleocr, '__version__', 'unknown')

    @staticmethod
    def creator_tag(options: OcrOptions) -> str:
        return f"PaddleOCR {PaddleOcrEngine.version()}"

    def __str__(self) -> str:
        return f"PaddleOCR {self.version()}"

    @staticmethod
    def languages(options: OcrOptions) -> set[str]:
        return SUPPORTED_LANGUAGES   # 57 种语言，来自 lang_map.py

    # ── 方向检测（使用 PaddleOCR 内置分类器）──

    @staticmethod
    def get_orientation(input_file: Path, options: OcrOptions) -> OrientationConfidence:
        from paddleocr._models.doc_img_orientation_classification import (
            DocImgOrientationClassification,
        )
        clf = DocImgOrientationClassification()
        result = list(clf.predict(str(input_file)))
        if not result:
            return OrientationConfidence(angle=0, confidence=0.0)
        angle = int(result[0]['label_names'][0])
        score = float(result[0]['scores'][0])
        # 将 0-1 的置信度映射到 ocrmypdf 的 0-15 置信度范围
        confidence = score * 15.0
        return OrientationConfidence(angle=angle, confidence=confidence)

    # ── 纠偏（通过检测文本框倾斜角度取中位数）──

    @staticmethod
    def get_deskew(input_file: Path, options: OcrOptions) -> float:
        engine = _get_paddle_engine(options)
        result = engine.predict(str(input_file))
        if not result or not result[0]:
            return 0.0

        dt_polys = result[0].get('dt_polys', [])
        if not dt_polys:
            return 0.0

        # 计算每个文本框顶部边缘的倾斜角度
        angles = []
        for poly in dt_polys:
            if len(poly) < 2:
                continue
            dx = float(poly[1][0] - poly[0][0])
            dy = float(poly[1][1] - poly[0][1])
            if abs(dx) < 1:
                continue
            angles.append(math.degrees(math.atan2(dy, dx)))

        if not angles:
            return 0.0

        # 取中位数（比均值更抗异常值）
        angles.sort()
        mid = len(angles) // 2
        if len(angles) % 2 == 0:
            return (angles[mid - 1] + angles[mid]) / 2.0
        return angles[mid]

    # ── 核心 OCR ──

    @staticmethod
    def supports_generate_ocr() -> bool:
        return True   # 支持新的 generate_ocr 接口（不用旧版 generate_pdf）

    @staticmethod
    def generate_ocr(
        input_file: Path,
        options: OcrOptions,
        page_number: int = 0,
    ) -> tuple[OcrElement, str]:
        """对单页图片执行 PaddleOCR，返回 OcrElement 树 + 文本"""
        engine = _get_paddle_engine(options)

        # 读取图片尺寸和 DPI
        with Image.open(input_file) as img:
            img_width, img_height = img.size
            dpi_info = img.info.get('dpi', (300, 300))
            dpi = float(dpi_info[0] if isinstance(dpi_info, tuple) else dpi_info)
            if dpi <= 0:
                dpi = 300.0

        # 创建 PAGE 级 OcrElement
        page = OcrElement(
            ocr_class=OcrClass.PAGE,
            bbox=BoundingBox(left=0, top=0, right=img_width, bottom=img_height),
            dpi=dpi,
            page_number=page_number,
        )

        # 执行推理（带异常重试）
        try:
            result = engine.predict(str(input_file), return_word_box=True)
        except KeyError:
            # PaddleOCR bug: return_word_box=True 在空白图片上报 KeyError
            result = engine.predict(str(input_file))
        except RuntimeError:
            # PaddlePaddle C++ 预测器被 ThreadPoolExecutor 跨生命周期重用时可能变脏
            log.debug("PaddlePaddle inference failed, recreating engine")
            _reset_paddle_engine()
            engine = _get_paddle_engine(options)
            result = engine.predict(str(input_file), return_word_box=True)

        # ── 向 stderr 写入页号进度标记 ──
        # 这是实时进度反馈的关键！
        sys.stderr.write(f"[{page_number + 1}]\n")
        sys.stderr.flush()

        if not result or not result[0]:
            return page, ""

        # 提取识别结果
        ocr_data = result[0]
        rec_texts = ocr_data.get('rec_texts', [])
        rec_scores = ocr_data.get('rec_scores', [])
        rec_boxes = ocr_data.get('rec_boxes', [])

        # 可选：词级边界框
        text_words = ocr_data.get('text_word', [])
        text_word_regions = ocr_data.get('text_word_region', [])
        has_word_boxes = bool(text_words and text_word_regions)

        text_parts = []

        # 构建 OcrElement 树（PAGE → LINE → WORD）
        for i, (text, score, box) in enumerate(zip(rec_texts, rec_scores, rec_boxes)):
            if not text.strip():
                continue

            x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
            if x2 <= x1 or y2 <= y1:
                continue

            line_bbox = BoundingBox(left=x1, top=y1, right=x2, bottom=y2)
            line = OcrElement(ocr_class=OcrClass.LINE, bbox=line_bbox)

            if has_word_boxes and i < len(text_words) and text_words[i]:
                # 有词级边界框：每个词独立创建 WORD 元素
                for token, quad in zip(text_words[i], text_word_regions[i]):
                    token = str(token).strip()
                    if not token:
                        continue
                    word_bbox = _quad_to_bbox(quad)
                    if word_bbox is None:
                        continue
                    word = OcrElement(
                        ocr_class=OcrClass.WORD,
                        bbox=word_bbox,
                        text=token,
                        confidence=float(score),
                    )
                    line.children.append(word)
            else:
                # 降级：整个文本行作为单个 WORD 元素
                word = OcrElement(
                    ocr_class=OcrClass.WORD,
                    bbox=line_bbox,
                    text=text,
                    confidence=float(score),
                )
                line.children.append(word)

            if line.children:
                page.children.append(line)
                text_parts.append(text)

        full_text = '\n'.join(text_parts)
        return page, full_text

    # ── 旧版 generate_pdf（当 supports_generate_ocr=False 时使用，本插件已不再走此路径）──

    @staticmethod
    def generate_pdf(input_file, output_pdf, output_text, options):
        """直接把图片写入 PDF（由 ocrmypdf sandwich 渲染负责叠加文字层）"""
        from fpdf import FPDF
        # ...（简单地将 PNG 图片嵌入 PDF 页面）
        # 实际 OCR 结果已通过 generate_ocr 返回，ocrmypdf 会自行将文字层叠加

    @staticmethod
    def generate_hocr(input_file, output_hocr, output_text, options):
        raise NotImplementedError("Use generate_ocr()")
```

**关键行 —— 进度输出的来源：**

```python
# 在 generate_ocr() 中，每处理完一页后：
sys.stderr.write(f"[{page_number + 1}]\n")
sys.stderr.flush()
```

这一行向 stderr 输出 `[页码]` 格式的标记（如 `[1]`, `[2]`, `[3]`...），
主进程通过管道读取并解析这些标记，实现实时进度反馈。

#### 2.3.4 设计亮点与容错

| 设计点 | 实现 |
|-------|------|
| 引擎缓存 | 全局单例，仅在语言变更时重建 |
| OMP_THREAD_LIMIT 清理 | Tesseract 插件会设定此环境变量为 1，本插件主动移除 |
| 空白图处理 | `return_word_box=True` 在空白图上抛 KeyError → 重试不带此参数 |
| C++ 预测器脏状态 | RuntimeError 时重置引擎并重试一次 |
| 纠偏算法 | 取所有文本框顶部边缘的倾斜角中位数（抗异常值） |
| 词级边界框 | 有词级数据时创建 WORD 元素，否则降级为 LINE 级 |

---

### 2.4 `lang_map.py` —— 语言代码映射

**路径:** `venv-paddle311\Lib\site-packages\ocrmypdf_paddleocr\lang_map.py`

```python
# SPDX-License-Identifier: MPL-2.0

"""Map Tesseract language codes to PaddleOCR language codes."""

from __future__ import annotations

_LANG_MAP: dict[str, str] = {
    'eng': 'en',      'kor': 'korean',    'chi_sim': 'ch',
    'chi_tra': 'chinese_cht',  'jpn': 'japan',   'deu': 'german',
    'fra': 'french',  'spa': 'es',        'por': 'pt',
    'ita': 'it',      'rus': 'ru',        'ara': 'ar',
    'hin': 'hi',      'vie': 'vi',        'tha': 'th',
    'tur': 'tr',      'ukr': 'uk',        'pol': 'pl',
    'nld': 'nl',      'nor': 'no',        'swe': 'sv',
    'dan': 'da',      'fin': 'fi',        'hun': 'hu',
    'ces': 'cs',      'ron': 'ro',        'bul': 'bg',
    'hrv': 'hr',      'slk': 'sk',        'slv': 'sl',
    'ell': 'el',      'heb': 'he',        'ind': 'id',
    'msa': 'ms',      'tam': 'ta',        'tel': 'te',
    'kan': 'ka',      'mar': 'mr',        'nep': 'ne',
    'ben': 'bn',      'urd': 'ur',        'fas': 'fa',
    'mya': 'my',      'khm': 'km',        'lao': 'lo',
    'lat': 'la',      'est': 'et',        'lav': 'lv',
    'lit': 'lt',
}

SUPPORTED_LANGUAGES: set[str] = set(_LANG_MAP.keys())


def tesseract_to_paddle(lang: str) -> str:
    """Convert Tesseract language code to PaddleOCR code."""
    return _LANG_MAP.get(lang, lang)
```

共支持 **57 种语言**，使用 Tesseract 语言代号作为外部接口（与 ocrmypdf 保持一致），内部映射到 PaddleOCR 的语言代号。

---

## 3. 主进程集成代码

### 3.1 `pipeline.py` —— OCR 引擎选择与调用

#### 3.1.1 PaddleOCR venv 检测

**`backend\engine\pipeline.py:2262-2282`**

```python
# ── 寻找 PaddleOCR 专用 Python 3.11 venv ──
_paddle_venv_py = ""
if ocr_engine == "paddleocr":
    _base_dir = os.path.dirname(os.path.dirname(__file__))
    for _cand in [
        r"D:\opencode\book-downloader\venv-paddle311\Scripts\python.exe",
        os.path.join(_base_dir, "venv-paddle311", "Scripts", "python.exe"),
    ]:
        if os.path.exists(_cand):
            # 验证 venv 中是否安装了 ocrmypdf_paddleocr
            _vr = _sp.run([_cand, "-c", "import ocrmypdf_paddleocr"],
                          capture_output=True, timeout=15)
            if _vr.returncode == 0:
                _paddle_venv_py = _cand
                task_store.add_log(task_id, f"PaddleOCR: using venv at {_paddle_venv_py}")
                break
    if not _paddle_venv_py:
        task_store.add_log(task_id,
            "PaddleOCR: Python 3.11 venv not found — 点击设置页 OCR → PaddleOCR → 安装 自动搭建")
```

**为什么要单独用 venv?**
- book-downloader 主程序编译为 Python 3.14 的 PyInstaller exe
- PaddlePaddle **不支持 Python 3.14**（要求 3.11）
- 因此需要独立的 Python 3.11 venv 来运行 ocrmypdf + paddleocr

#### 3.1.2 OCR 命令构建

**`backend\engine\pipeline.py:2360-2376`**

```python
# PaddleOCR always uses single process (PaddlePaddle uses all CPU cores internally)
from platform_utils import configure_tesseract_env
configure_tesseract_env()
_ocr_env = {**os.environ}
cmd = [
    _paddle_venv_py, "-m", "ocrmypdf",
    "--plugin", "ocrmypdf_paddleocr",       # ← 加载本插件
    "--optimize", _opt_level,               # GhostScript 优化级别
    "--oversample", ocr_oversample,         # DPI 过采样
    "-l", ocr_lang or "chi_sim+eng",        # 语言
    "-j", "1",                              # 单进程（插件内部也会强制）
    "--output-type", "pdf",
    "--max-image-mpixels", "0",             # 不限制图片像素
    "--mode", "force",                      # 强制 OCR（即使已有文字层）
    pdf_path,
    output_pdf,
]
exit_code = await _run_ocrmypdf_with_progress(
    task_id, cmd, env=_ocr_env,
    timeout=ocr_timeout, total_pages=_total_pages,
    output_pdf=output_pdf,
)
```

#### 3.1.3 结果处理

```python
if exit_code == 0:
    task_store.add_log(task_id, "OCR completed, validating quality...")
    if _is_ocr_readable(output_pdf, python_cmd=_py_for_ocr):
        os.replace(output_pdf, pdf_path)    # 替换原 PDF
        task_store.add_log(task_id, "OCR quality check passed")
        report["ocr_done"] = True
    else:
        task_store.add_log(task_id, "OCR quality check failed, keeping original PDF")
else:
    # 异常退出但输出文件可能有效（进程被暂停后自然结束等边缘情况）
    if os.path.exists(output_pdf) and os.path.getsize(output_pdf) > 1024:
        if _is_ocr_readable(output_pdf, python_cmd=_py_for_ocr):
            os.replace(output_pdf, pdf_path)
            report["ocr_done"] = True
```

---

## 4. 实时进度反馈机制

### 4.1 `_run_ocrmypdf_with_progress` —— 核心函数

**`backend\engine\pipeline.py:105-287`**

#### 4.1.1 子进程创建

```python
async def _run_ocrmypdf_with_progress(
    task_id: str, cmd: List[str],
    env=None, timeout: int = 7200,
    total_pages: int = 0,        # ← 已知总页数（如 217）
    output_pdf: str = "",
) -> int:
    """Run ocrmypdf with real-time stderr progress parsing."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,   # ← stderr 合并到 stdout
        env={**{"PYTHONUNBUFFERED": "1"}, ...},
    )
```

**关键：** `stderr=asyncio.subprocess.STDOUT` 将 stderr 合并到 stdout，
使得插件的 `sys.stderr.write("[页码]\n")` 输出能通过同一个 PIPE 被读取。

#### 4.1.2 读取器 `_reader()` —— 逐行解析

```python
async def _reader(p) -> int:
    nonlocal _cur, _tot, _last, _had_output
    _last_output = time.time()

    while True:
        try:
            _line = await asyncio.wait_for(p.stdout.readline(), timeout=10)
        except asyncio.TimeoutError:
            # 10 秒无输出检查是否已完成
            if p.returncode is not None:
                break
            # 暂停检测
            _t = task_store.get(task_id)
            if _t and _t.get("status") == "paused":
                await asyncio.sleep(1)
                continue
            # 所有页已完成且静默超过 30 秒，视为完成
            _idle = time.time() - _last_output
            if _tot > 0 and _cur >= _tot and _idle > 30:
                break
            continue

        if not _line:
            if p.returncode is not None:
                break
            await asyncio.sleep(1)
            continue

        _last_output = time.time()
        _text = _line.decode(errors='replace').strip()
        if not _text:
            continue
```

#### 4.1.3 无害警告过滤（过滤掉 PaddleOCR 启动时的杂讯）

```python
        _skip_patterns = [
            "No ccache found",
            "warnings.warn",
            "UserWarning",
            "提供的模式无法找到文件",      # ← 常见无害警告
            "Model files already exist",
            "To redownload, please delete",
        ]
        if any(p in _text for p in _skip_patterns):
            continue
```

#### 4.1.4 四种进度正则匹配

```python
        # ── 模式 1: 双数字括号 [N/M] —— ocrmypdf 主进程输出 ──
        _m = re.search(r'\[(\d+)/(\d+)\]', _text)
        if _m:
            _cur = int(_m.group(1))
            _tot = int(_m.group(2))

        # ── 模式 2: 单数字括号 [N] —— PaddleOCR 插件输出的页码！ ──
        elif total_pages > 0:
            _m0 = re.search(r'\[(\d+)\]', _text)
            if _m0:
                _cur = int(_m0.group(1))
                _tot = total_pages
                if _cur % 1 == 0 or _cur == total_pages:
                    # ★ 这就是日志看到的 "PaddleOCR: 1/217 页" 来源
                    task_store.add_log(task_id, f"  PaddleOCR: {_cur}/{_tot} 页")
                continue   # 跳过原始 [N] 行（避免日志污染）

        # 未被匹配到的行 → 直接记录到日志（截断 200 字符）
        task_store.add_log(task_id, f"  {_text[:200]}")

        # ── 模式 3: "Page X of Y" —— Tesseract 等引擎的替代格式 ──
        _m2 = re.search(r'[Pp]age\s+(\d+)\s+[oO]f\s+(\d+)', _text)
        if _m2:
            _cur = int(_m2.group(1))
            _tot = int(_m2.group(2))

        # ── 模式 4: "N [tesseract]" —— Tesseract 引擎格式 ──
        if total_pages > 0:
            _m3 = re.match(r'\s*(\d+)\s+\[tesseract\]', _text)
            if _m3:
                _cur = int(_m3.group(1))
                _tot = total_pages
```

#### 4.1.5 百分比 + ETA 计算与发射

```python
        _now = time.time()
        if _tot > 0 and _cur > 0:
            _pct = int(_cur / _tot * 100)
            _elapsed = _now - _start
            _eta = ""
            if _cur > 1 and _elapsed > 5:
                _sec_pp = _elapsed / _cur          # 每页秒数
                _rem = (_tot - _cur) * _sec_pp     # 剩余秒数
                _eta = _format_eta(_rem)           # "约X时Y分" 或 "约Y分Z秒"

            # 仅在百分比变化或超过 10 秒无更新时发射
            if _pct != _last or (_now - _start - _last) > 10:
                _last = _pct
                await _emit_progress(task_id, "ocr", _pct,
                                     f"{_cur}/{_tot} 页", _eta)
```

#### 4.1.6 心跳监控 `_monitor()`

```python
async def _monitor(p):
    """每 5 秒检查：取消/暂停状态 + 发送心跳"""
    nonlocal _cur, _tot, _last, _last_mtime
    _was_suspended = False
    while p.returncode is None:
        await asyncio.sleep(5)
        if p.returncode is not None:
            break
        # 取消检查
        _t = task_store.get(task_id)
        if _t and _t.get("status") == "cancelled":
            p.kill(); break
        # 暂停/恢复
        if _t and _t.get("status") == "paused":
            if not _was_suspended:
                _suspend_process(p.pid)    # Windows: NtSuspendProcess
                _was_suspended = True
            await asyncio.sleep(2); continue
        if _was_suspended and _t and _t.get("status") != "paused":
            _was_suspended = False
            _resume_process(p.pid)

        _now = time.time()
        _elapsed_sec = int(_now - _start)
        if _cur == 0 or total_pages == 0:
            # 没有页级信息 → 发送时间心跳
            _detail = f"处理中... {_elapsed_sec//60}分{_elapsed_sec%60}秒"
            await _emit_progress(task_id, "ocr", 0, _detail, "")
```

#### 4.1.7 超时保护

```python
try:
    return await asyncio.wait_for(_reader(proc), timeout=timeout)
except asyncio.TimeoutError:
    proc.kill()
    raise
finally:
    _monitor_task.cancel()
```

---

### 4.2 进度数据流的完整链路

```
┌───────────────────────────────────────────────────────────────────────┐
│                         数据产出端 (子进程)                            │
│                                                                       │
│  ocrmypdf_paddleocr/engine.py:generate_ocr()                          │
│    │                                                                  │
│    ├─► sys.stderr.write("[1]\n")    ← 第 1 页完成                     │
│    ├─► sys.stderr.write("[2]\n")    ← 第 2 页完成                     │
│    ├─► sys.stderr.write("[3]\n")    ← 第 3 页完成                     │
│    └─► ...                                                             │
│                                                                       │
│  PaddleOCR 模型加载阶段（由 PaddleOCR 内部 logging 输出）：              │
│    Creating model: ('PP-LCNet_x1_0_textline_ori', None)               │
│    Creating model: ('PP-OCRv5_server_det', None)                      │
│    Creating model: ('PP-OCRv5_server_rec', None)                      │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                         数据传输层                                     │
│                                                                       │
│  asyncio.create_subprocess_exec(                                       │
│      stdout=PIPE, stderr=STDOUT  ← 合并 stderr 到 stdout              │
│  )                                                                    │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                         数据消费端 (主进程)                             │
│                                                                       │
│  _reader() — 逐行 await p.stdout.readline()                           │
│    │                                                                  │
│    ├─► 过滤 skip_patterns（无害警告）                                   │
│    │     "No ccache found", "提供的模式无法找到文件", ...               │
│    │                                                                  │
│    ├─► 模式 2 regex: r'\[(\d+)\]' → _cur=页码, _tot=total_pages       │
│    │     → task_store.add_log(f"  PaddleOCR: {_cur}/{_tot} 页")       │
│    │                                                                  │
│    ├─► 未匹配行 → task_store.add_log(原始内容, 截断200字符)             │
│    │     "Creating model: ('PP-OCRv5_server_det', None)"               │
│    │                                                                  │
│    └─► 计算 _pct=int(_cur/_tot*100) + ETA                             │
│         → _emit_progress(task_id, "ocr", _pct, f"{_cur}/{_tot}页", "")│
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                         前端消费层                                     │
│                                                                       │
│  WebSocket: ws://host/ws/{client_id}                                  │
│    → step_progress event                                              │
│    → TaskDetail 面板: 进度条 百分比 + "PaddleOCR: N/217 页"            │
│                                                                       │
│  HTTP GET /api/v1/tasks/{task_id}                                     │
│    → logs field: ["PaddleOCR: 1/217 页", "PaddleOCR: 2/217 页", ...]  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 5. 安装与检测逻辑

### 5.1 检测 (Detect)

**`backend\api\search.py:1171-1197`**

```python
elif engine == "paddleocr":
    _base_dir = os.path.dirname(os.path.dirname(__file__))
    _venv_candidates = [
        r"D:\opencode\book-downloader\venv-paddle311\Scripts\python.exe",
        os.path.join(_base_dir, "venv-paddle311", "Scripts", "python.exe"),
    ]
    for _venv_py in _venv_candidates:
        if os.path.exists(_venv_py):
            r = subprocess.run(
                [_venv_py, "-c", "import paddleocr; print(paddleocr.__version__)"],
                capture_output=True, text=True, timeout=15)
            if r.returncode == 0:
                return {"ok": True, "engine": "paddleocr",
                        "version": r.stdout.strip().split("\n")[0],
                        "venv": _venv_py}
            return {"ok": False, ...}
    # 回退：尝试系统 Python
    py = _pip_install_cmd()[0]
    r = subprocess.run([py, "-c", "import paddleocr; print(paddleocr.__version__)"],
                       capture_output=True, text=True, timeout=10)
    if r.returncode == 0:
        return {"ok": True, ...}
```

### 5.2 安装 (Install)

**`backend\api\search.py:1355-1398`**

```python
elif engine == "paddleocr":
    # 1. 找到 Python 3.11
    from platform_utils import find_python_executable
    _py311 = find_python_executable("3.11")

    # 2. 创建 venv
    subprocess.run([_py311, "-m", "venv", _venv_dir], ...)

    # 3. 安装依赖（精确版本锁定）
    _venv_py = os.path.join(_venv_dir, "Scripts", "python.exe")
    subprocess.run([_venv_py, "-m", "pip", "install", "--upgrade", "pip"], ...)

    # 可选：尝试 GPU 版本
    subprocess.run([_venv_py, "-m", "pip", "install", "paddlepaddle-gpu"], ...)

    # 核心依赖
    subprocess.run([_venv_py, "-m", "pip", "install",
                    "paddlepaddle==3.0.0",
                    "paddleocr>=3.2.0,<3.3.0",
                    "paddlex",
                    "ocrmypdf",
                    "ocrmypdf-paddleocr",     # ← 插件本体
                   ], ...)

    # 再次确认插件安装
    subprocess.run([_venv_py, "-m", "pip", "install", "ocrmypdf-paddleocr"], ...)
```

### 5.3 依赖关系图

```
ocrmypdf-paddleocr 0.1.1
  ├── ocrmypdf >= 17.0           (OCR 框架，提供 OcrEngine 接口 + pluggy 插件系统)
  ├── paddleocr >= 3.0.0, <3.3.0 (PaddleOCR Python 绑定)
  ├── paddlepaddle >= 3.0.0, <3.3.0 (PaddlePaddle 深度学习框架)
  └── pillow >= 10.0             (图片读写)
```

---

## 6. 完整调用链路图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  前端操作                                                                    │
│  创建任务 → 设置 OCR 引擎为 paddleocr → 点击执行                              │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ HTTP POST /api/v1/tasks/{id}/start
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  pipeline.py:_step_ocr()                                                     │
│                                                                             │
│  1. 检测 ocr_engine == "paddleocr"                                          │
│  2. _is_scanned(pdf_path) → 是否已有文字层                                   │
│  3. 寻找 venv-paddle311/Scripts/python.exe                                  │
│     ├─ 找到 → import ocrmypdf_paddleocr 验证可用                             │
│     └─ 未找到 → 日志提示到设置页安装                                          │
│  4. 构建命令: venv_python -m ocrmypdf --plugin ocrmypdf_paddleocr ...        │
│  5. 调用 _run_ocrmypdf_with_progress(task_id, cmd, total_pages=217)          │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  _run_ocrmypdf_with_progress()                                               │
│                                                                             │
│  asyncio.create_subprocess_exec(cmd, stdout=PIPE, stderr=STDOUT)             │
│       │                                                                     │
│       ├─► _reader() 协程: 逐行 readline() stdout                             │
│       │     ├─ 跳过: "No ccache found", "提供的模式无法找到文件" 等            │
│       │     ├─ 匹配 r'\[(\d+)\]' → PaddleOCR: 1/217 页                      │
│       │     ├─ 匹配 r'\[(\d+)/(\d+)\]' → ocrmypdf 内置进度                  │
│       │     ├─ 记录原始日志: "Creating model: ..."                            │
│       │     └─ 发射进度: _emit_progress(step="ocr", pct=46, detail="1/217页") │
│       │                                                                     │
│       └─► _monitor() 协程: 每 5s 心跳 + 暂停/取消检测                        │
│                                                                             │
│  子进程内部:                                                                  │
│       │                                                                     │
│       ├─► ocrmypdf 主流程: 页面拆分 → 预处理 → 逐页调用插件                    │
│       │                                                                     │
│       ├─► ocrmypdf_paddleocr/__init__.py                                     │
│       │   ├─ initialize() → import paddleocr 验证                            │
│       │   ├─ check_options() → 强制 jobs=1                                   │
│       │   └─ get_ocr_engine() → 返回 PaddleOcrEngine()                       │
│       │                                                                     │
│       └─► ocrmypdf_paddleocr/engine.py                                      │
│           └─ generate_ocr(input_file, options, page_number)                  │
│               ├─ _get_paddle_engine() → 缓存或创建 PaddleOCR(lang)            │
│               │     └─ PaddleOCR 内部 load model:                             │
│               │         Creating model: ('PP-LCNet_x1_0_textline_ori', None)  │
│               │         Creating model: ('PP-OCRv5_server_det', None)        │
│               │         Creating model: ('PP-OCRv5_server_rec', None)        │
│               ├─ engine.predict(image) → 识别结果                             │
│               ├─ sys.stderr.write(f"[{page_number+1}]\n")  ★ 进度标记!       │
│               └─ return (OcrElement树, 文本内容)                              │
│                                                                             │
│  退出后:                                                                     │
│       ├─ exit_code == 0 → _is_ocr_readable() 质量检查 → os.replace() 替换    │
│       └─ exit_code != 0 → 尝试打捞有效输出 / 保留原文件                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 附录：与日志样本对照

```
日志行                         │ 来源                         │ 处理方式
──────────────────────────────┼──────────────────────────────┼─────────────────────────
提供的模式无法找到文件          │ PaddleOCR font 查找警告       │ skip_patterns 过滤
Creating model: PP-LCNet...   │ PaddleOCR 内部 logging       │ 直接记录到 task log
Creating model: PP-OCRv5_...  │ PaddleOCR 内部 logging       │ 直接记录到 task log
Creating model: PP-OCRv5_...  │ PaddleOCR 内部 logging       │ 直接记录到 task log
PaddleOCR: 1/217 页           │ 插件 sys.stderr("[1]")        │ regex r'\[(\d+)\]' 匹配
                               │  + pipeline 格式化            │ 记录到 task log
PaddleOCR: 2/217 页           │ 插件 sys.stderr("[2]")        │ 同上
PaddleOCR: 3/217 页           │ 插件 sys.stderr("[3]")        │ 同上
PaddleOCR: 4/217 页           │ 插件 sys.stderr("[4]")        │ 同上
PaddleOCR: 5/217 页           │ 插件 sys.stderr("[5]")        │ 同上
...                            │ ...                          │ ...
```
