# AA SS Code Search with "duxiu" Keyword

## Summary

When the download pipeline searches Anna's Archive by SS code, append the keyword "duxiu" to narrow results to the correct book entry. This matches how Anna's Archive indexes books from the Duxiu (读秀) digital library system.

## Current Behavior

In `_download_via_aa_and_stacks()` (`engine/pipeline.py:905`), the SS code is passed directly to `search_aa()`:

```python
search_queries.append(("SS", ss_code))
# → https://annas-archive.gd/search?q=11242359
```

## Desired Behavior

Append "duxiu" to the SS code query string:

```python
search_queries.append(("SS", f"{ss_code} duxiu"))
# → https://annas-archive.gd/search?q=11242359+duxiu
```

## Scope

| What | Change? |
|------|---------|
| `engine/pipeline.py:905` — `_download_via_aa_and_stacks()` | **Yes** — append `" duxiu"` |
| `engine/aa_downloader.py` — URL construction | No change — `search_aa()` receives the modified string transparently |
| `api/search.py` — frontend AA search API | No change — does not use ss_code for AA queries |
| MD5 extraction, detail fetching, title/ISBN matching | No change — downstream logic unchanged |
| Stacks download and file naming | No change — files still named `{ss_code}_{safe_title}.{ext}` |

## Fallback

No fallback to bare ss_code query. If the compound query returns 0 results, the pipeline stops at AA search (same as current behavior when any query returns 0 results).

## Rationale

Anna's Archive indexes SS-coded books with the "duxiu" keyword in metadata. Searching by `ss_code` alone may return unrelated entries or too many results. The compound query `"{ss_code} duxiu"` produces a narrower, more accurate result set. Example:

- `11242359` → many unrelated results across different sources
- `11242359 duxiu` → specifically the Duxiu-sourced entry for SS 11242359

## Config

Hardcoded — no config option needed. "duxiu" is intrinsic to how Duxiu-sourced books are indexed on Anna's Archive.
