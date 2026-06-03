"""Realistic browser-footprint header generation (anti-bot mitigation).

WAF/Cloudflare layers in front of some ATS endpoints score requests on how closely
they resemble a real browser. :func:`build_headers` returns a fresh, internally
consistent header set on every call: a randomly chosen modern ``User-Agent`` plus the
matching ``Sec-Ch-Ua`` client hints, language, and fetch-metadata headers.

The User-Agent and its Client-Hint headers are kept consistent with one another
(picking a Chrome UA also emits Chrome-shaped ``Sec-Ch-Ua``) because mismatches
between them are exactly what naive bot detectors look for.
"""

from __future__ import annotations

import random

# Each profile bundles a UA string with the client-hint values that a real browser
# of that type/version would send, so the footprint is self-consistent.
_PROFILES: list[dict[str, str]] = [
    {
        "ua": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"',
        "platform": '"Windows"',
    },
    {
        "ua": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
        "sec_ch_ua": '"Chromium";v="123", "Google Chrome";v="123", "Not.A/Brand";v="99"',
        "platform": '"macOS"',
    },
    {
        "ua": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
        ),
        "sec_ch_ua": '"Microsoft Edge";v="124", "Chromium";v="124", "Not.A/Brand";v="99"',
        "platform": '"Windows"',
    },
    {
        # Firefox does not send Sec-Ch-Ua; we omit those keys for this profile so the
        # footprint stays consistent with a real Firefox request.
        "ua": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) "
            "Gecko/20100101 Firefox/125.0"
        ),
        "sec_ch_ua": "",
        "platform": '"Windows"',
    },
]

_ACCEPT_LANGUAGES = ["en-US,en;q=0.9", "en-GB,en;q=0.8", "en-US,en;q=0.8,fr;q=0.5"]


def build_headers(*, json_request: bool = True) -> dict[str, str]:
    """Return a fresh, self-consistent browser header set.

    Args:
        json_request: When True (the default) advertise a JSON-friendly ``Accept``
            header appropriate for the ATS API calls.
    """
    profile = random.choice(_PROFILES)
    headers: dict[str, str] = {
        "User-Agent": profile["ua"],
        "Accept": (
            "application/json, text/plain, */*"
            if json_request
            else "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        ),
        "Accept-Language": random.choice(_ACCEPT_LANGUAGES),
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Connection": "keep-alive",
    }
    # Only Chromium-family profiles carry client hints.
    if profile["sec_ch_ua"]:
        headers["Sec-Ch-Ua"] = profile["sec_ch_ua"]
        headers["Sec-Ch-Ua-Mobile"] = "?0"
        headers["Sec-Ch-Ua-Platform"] = profile["platform"]
    return headers
