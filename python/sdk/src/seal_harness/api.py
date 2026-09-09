from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .client import HarnessClient, Notification, TransportClosedError


@dataclass(frozen=True)
class SealHarnessConfig:
    cwd: str | None = None
    provider: str = "deepseek"
    model: str = "deepseek-chat"
    reasoning: str | None = None
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    config_path: str | None = None
    command: str = "seal-harness-rpc"
    args: tuple[str, ...] | None = None
    env: dict[str, str] | None = None
    initialize_timeout: float = 10.0
    request_timeout: float | None = None
    shutdown_timeout: float = 1.0
    dispose_eof_grace_timeout: float = 6.0
    dispose_grace_timeout: float = 3.0


@dataclass(frozen=True)
class RunResult:
    session_id: str
    run_id: str
    final_response: str
    finish_reason: str
    events: tuple[dict[str, Any], ...]
    notifications: tuple[Notification, ...]


class SealHarness:
    def __init__(self, config: SealHarnessConfig | None = None, **kwargs: Any) -> None:
        if config is not None and kwargs:
            raise TypeError("pass either SealHarnessConfig or keyword options, not both")
        self.config = config or SealHarnessConfig(**kwargs)
        if self.config.max_tokens is not None and (isinstance(self.config.max_tokens, bool) or not isinstance(self.config.max_tokens, int) or self.config.max_tokens <= 0):
            raise ValueError("max_tokens must be a positive integer")
        self.cwd = str(Path(self.config.cwd or Path.cwd()).resolve())
        self._args = self.config.args or (
            "--cwd", self.cwd, "--provider", self.config.provider,
            *(("--config", self.config.config_path) if self.config.config_path else ()),
        )
        self.client = self._create_client()
        self._initialized = False
        self._closed = False

    def _create_client(self) -> HarnessClient:
        environment = os.environ.copy() if self.config.env is None else dict(self.config.env)
        return HarnessClient(
            self.config.command, self._args, cwd=self.cwd, env=environment,
            request_timeout=self.config.request_timeout,
            shutdown_timeout=self.config.shutdown_timeout,
            dispose_eof_grace_timeout=self.config.dispose_eof_grace_timeout,
            dispose_grace_timeout=self.config.dispose_grace_timeout,
        )

    def __enter__(self) -> "SealHarness":
        self.start()
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()

    def start(self) -> None:
        if self._closed:
            raise TransportClosedError("Seal Harness SDK client is closed")
        if self._initialized:
            return
        try:
            reasoning_effort = self.config.reasoning_effort or self.config.reasoning
            initialize_params: dict[str, Any] = {
                "cwd": self.cwd,
                "provider": self.config.provider,
                "model": self.config.model,
            }
            if reasoning_effort is not None:
                initialize_params["reasoningEffort"] = reasoning_effort
            if self.config.max_tokens is not None:
                initialize_params["maxTokens"] = self.config.max_tokens
            self.client.request("initialize", initialize_params, timeout=self.config.initialize_timeout)
        except BaseException:
            self.client.close()
            if not self._closed:
                self.client = self._create_client()
            raise
        self._initialized = True

    def close(self) -> None:
        self._closed = True
        self.client.close()
        self._initialized = False

    def session(self, session_id: str | None = None) -> "Session":
        return Session(self, session_id or f"session-{uuid.uuid4().hex}")

    def run(
        self,
        prompt: str,
        *,
        session_id: str | None = None,
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        return self.session(session_id).run(prompt, on_notification=on_notification)


class Session:
    def __init__(self, harness: SealHarness, session_id: str) -> None:
        self.harness = harness
        self.id = session_id

    def run(
        self,
        prompt: str,
        *,
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        self.harness.start()
        events: list[dict[str, Any]] = []
        notifications: list[Notification] = []

        def collect(notification: Notification) -> None:
            notifications.append(notification)
            event = notification.params.get("event")
            if notification.method == "event" and isinstance(event, dict):
                events.append(event)
            if on_notification is not None:
                on_notification(notification)

        params: dict[str, Any] = {
            "cwd": self.harness.cwd,
            "provider": self.harness.config.provider,
            "model": self.harness.config.model,
            "prompt": prompt,
            "sessionId": self.id,
        }
        reasoning_effort = self.harness.config.reasoning_effort or self.harness.config.reasoning
        if reasoning_effort is not None:
            params["reasoning"] = reasoning_effort
        if self.harness.config.max_tokens is not None:
            params["maxTokens"] = self.harness.config.max_tokens
        result = self.harness.client.request("prompt", params, on_notification=collect)
        if not isinstance(result, dict):
            raise TypeError("RPC prompt result must be an object")
        return RunResult(
            session_id=_required_string(result, "sessionId"),
            run_id=_required_string(result, "runId"),
            final_response="".join(
                str(event.get("delta", "")) for event in events if event.get("type") == "text_delta"
            ),
            finish_reason=_required_string(result, "stopReason"),
            events=tuple(events),
            notifications=tuple(notifications),
        )


def _required_string(value: dict[str, Any], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result:
        raise TypeError(f"RPC prompt result {key} must be a non-empty string")
    return result
