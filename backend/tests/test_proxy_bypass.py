# -*- coding: utf-8 -*-
"""Tests for _make_proxies localhost proxy bypass logic."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine import _make_proxies, _LOCALHOST_NO_PROXY

PROXY = "http://127.0.0.1:10808"


class TestMakeProxies:
    def test_no_proxy_returns_none(self):
        assert _make_proxies("http://example.com", "") is None
        assert _make_proxies("http://example.com", None) is None

    def test_localhost_returns_none(self):
        for host in _LOCALHOST_NO_PROXY:
            if host == "::1":
                url = "http://[::1]:7788/api/status"
                url_https = "https://[::1]:443/path"
            else:
                url = f"http://{host}:7788/api/status"
                url_https = f"https://{host}:443/path"
            assert _make_proxies(url, PROXY) is None, f"Should bypass proxy for {host}"
            assert _make_proxies(url_https, PROXY) is None, f"Should bypass proxy for HTTPS {host}"

    def test_external_returns_proxy_dict(self):
        result = _make_proxies("https://annas-archive.gd/search?q=test", PROXY)
        assert result == {"http": PROXY, "https": PROXY}

        result = _make_proxies("http://google.com", PROXY)
        assert result == {"http": PROXY, "https": PROXY}

    def test_localhost_with_port_is_excluded(self):
        result = _make_proxies("http://localhost:8191/v1", PROXY)
        assert result is None

    def test_localhost_subdomain_is_NOT_excluded(self):
        result = _make_proxies("http://foo.localhost.example.com", PROXY)
        assert result is not None
        assert result == {"http": PROXY, "https": PROXY}

    def test_plain_ip_not_localhost_uses_proxy(self):
        result = _make_proxies("http://192.168.1.1:8080", PROXY)
        assert result == {"http": PROXY, "https": PROXY}

    def test_127_0_0_2_is_not_localhost(self):
        result = _make_proxies("http://127.0.0.2:8080", PROXY)
        assert result == {"http": PROXY, "https": PROXY}
