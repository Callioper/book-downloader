# AA SS Code "duxiu" Compound Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append the keyword "duxiu" to Anna's Archive search queries when searching by SS code, narrowing results to Duxiu-sourced book entries.

**Architecture:** Single-line string change in `_download_via_aa_and_stacks()`. The modified query string flows transparently through existing `search_aa()` → MD5 extraction → detail fetching → title matching → stacks download pipeline with zero downstream changes.

**Tech Stack:** Python 3, asyncio, existing `engine/search_engine.py` and `engine/aa_downloader.py` modules.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `backend/engine/pipeline.py:905` | Modify | Append `" duxiu"` to SS code AA query |

---

### Task 1: Append "duxiu" to SS code AA search query

**Files:**
- Modify: `backend/engine/pipeline.py:905`

- [ ] **Step 1: Make the edit**

In `backend/engine/pipeline.py`, locate the `_download_via_aa_and_stacks` function. Change line 905 from:

```python
        search_queries.append(("SS", ss_code))
```

to:

```python
        search_queries.append(("SS", f"{ss_code} duxiu"))
```

- [ ] **Step 2: Verify syntax**

```bash
python -m py_compile backend\engine\pipeline.py
```

Expected: No output (compilation succeeds silently).

- [ ] **Step 3: Run existing tests**

```bash
pytest tests\ -v --timeout=60 -x
```

Expected: All existing tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add backend/engine/pipeline.py
git commit -m "feat: append 'duxiu' keyword to AA SS code search queries"
```
