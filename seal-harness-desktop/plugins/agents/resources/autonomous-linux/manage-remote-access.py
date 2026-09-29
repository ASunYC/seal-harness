#!/usr/bin/env python3
"""Adapt the bundled Runtime address page for a fixed-host deployment.

The upstream Manager intentionally accepts loopback page origins only. A fixed-host
instance is opened through its trusted-LAN host, so its copied UI must derive public
addresses from the current page origin while keeping container-only services hidden.
The patch is exact and fails closed when the upstream bundle changes.
"""

from __future__ import annotations

import os
import pathlib
import stat
import sys
import tempfile
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        fail(f"manage remote access patch drifted at {label}")
    return source.replace(old, new)


def read_regular(path: pathlib.Path, label: str) -> tuple[str, os.stat_result]:
    file_stat = path.lstat()
    if not stat.S_ISREG(file_stat.st_mode) or stat.S_ISLNK(file_stat.st_mode):
        fail(f"{label} asset must be a regular file")
    if file_stat.st_size < 1 or file_stat.st_size > 512 * 1024:
        fail(f"{label} asset size is invalid")
    return path.read_text(encoding="utf-8"), file_stat


def write_atomic(path: pathlib.Path, source: str, file_stat: os.stat_result) -> None:
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=path.parent, delete=False
    ) as stream:
        stream.write(source)
        temporary = pathlib.Path(stream.name)
    try:
        os.chmod(temporary, stat.S_IMODE(file_stat.st_mode))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    if len(sys.argv) != 4:
        fail("usage: manage-remote-access.py <manage-addresses.js> <map-port> <chat-port>")
    addresses_path = pathlib.Path(sys.argv[1])
    try:
        map_port = int(sys.argv[2])
    except ValueError as error:
        raise RuntimeError("map port is invalid") from error
    if not 1 <= map_port <= 65535:
        fail("map port is outside the valid range")
    try:
        chat_port = int(sys.argv[3])
    except ValueError as error:
        raise RuntimeError("chat port is invalid") from error
    if not 1 <= chat_port <= 65535:
        fail("chat port is outside the valid range")

    source, addresses_stat = read_regular(addresses_path, "manage addresses")

    source = replace_once(
        source,
        "const ACCESS_ADDRESSES_PATH = '/manage/api/access-addresses';",
        "// STRATEX_MANAGE_REMOTE_ACCESS_V1\n"
        "const ACCESS_ADDRESSES_PATH = '/manage/api/access-addresses';",
        "marker",
    )
    source = replace_once(
        source,
        "  const loopbackHostnames = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);\n"
        "  if (!loopbackHostnames.has(origin.hostname.toLowerCase())) return null;\n\n",
        "",
        "page origin",
    )
    source = replace_once(
        source,
        "  dashboard.hash = '';\n"
        "  const runtimeChatDemo = new URL(descriptor.runtimeChatDemoUrl);\n"
        "  runtimeChatDemo.hostname = origin.hostname;\n\n"
        "  return {",
        "  dashboard.hash = '';\n\n"
        "  const runtimeChatDemo = new URL(origin.href);\n"
        "  runtimeChatDemo.protocol = 'http:';\n"
        f"  runtimeChatDemo.port = '{chat_port}';\n"
        "  runtimeChatDemo.pathname = '/';\n"
        "  runtimeChatDemo.search = '';\n"
        "  runtimeChatDemo.hash = '';\n\n"
        "  const cesiumMcpViewer = new URL(origin.href);\n"
        "  cesiumMcpViewer.protocol = 'http:';\n"
        f"  cesiumMcpViewer.port = '{map_port}';\n"
        "  cesiumMcpViewer.pathname = '/';\n"
        "  cesiumMcpViewer.search = '';\n"
        "  cesiumMcpViewer.hash = '';\n\n"
        "  return {",
        "public Cesium address",
    )
    source = replace_once(
        source,
        "    builtinMcp: [\n"
        "      { label: 'Cesium MCP Viewer', url: descriptor.cesiumMcpViewerUrl, canOpen: true },\n"
        "      { label: 'KnowledgeService MCP', url: descriptor.knowledgeServiceUrl, canOpen: true },\n"
        "    ],",
        "    builtinMcp: [\n"
        "      { label: 'Cesium MCP Viewer', url: cesiumMcpViewer.href, canOpen: true },\n"
        "    ],",
        "fixed-host MCP addresses",
    )
    source = replace_once(
        source,
        "        meta: '仅本机访问',",
        "        meta: '可信局域网访问',",
        "dashboard scope label",
    )
    source = replace_once(
        source,
        "        '本机管理入口',",
        "        '管理入口',",
        "management group title",
    )

    write_atomic(addresses_path, source, addresses_stat)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
