# engine package — heavy modules imported lazily inside functions

import os
from typing import Dict, Optional
from urllib.parse import urlparse

_LOCALHOST_NO_PROXY = {
    "localhost", "127.0.0.1", "::1", "0.0.0.0",
}


def _make_proxies(url: str, proxy: str) -> Optional[Dict[str, str]]:
    """Build proxies dict for a URL, bypassing proxy for localhost/loopback.
    Python requests ignores NO_PROXY when proxies= is explicitly passed,
    so we must check at the code level."""
    if not proxy:
        return None
    try:
        hostname = urlparse(url).hostname or ""
    except Exception:
        hostname = ""
    if hostname in _LOCALHOST_NO_PROXY:
        return None
    return {"http": proxy, "https": proxy}
