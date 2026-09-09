from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Iterator


class HarnessError(Exception): pass
class TransportClosedError(HarnessError): pass
class JsonRpcError(HarnessError): pass


@dataclass(frozen=True)
class Notification:
    method: str
    params: dict[str, Any]


NotificationFilter = Callable[[Notification], bool]


class NotificationSubscription(Iterator[Notification]):
    def __init__(self, unsubscribe: Callable[[], None], filter: NotificationFilter | None) -> None:
        self._unsubscribe, self._filter = unsubscribe, filter
        self._values: deque[Notification] = deque()
        self._failure: BaseException | None = None
        self._condition = threading.Condition()

    def next(self, timeout: float | None = None) -> Notification:
        with self._condition:
            if not self._values and self._failure is None:
                self._condition.wait_for(lambda: bool(self._values) or self._failure is not None, timeout)
            if self._values:
                return self._values.popleft()
            if self._failure is not None:
                raise self._failure
            raise TimeoutError("notification subscription timed out")

    def try_next(self) -> Notification | None:
        with self._condition:
            return self._values.popleft() if self._values else None

    def close(self) -> None:
        self._unsubscribe()
        with self._condition:
            self._values.clear()
            self._failure = TransportClosedError("Notification subscription closed")
            self._condition.notify_all()

    def __iter__(self) -> NotificationSubscription: return self
    def __next__(self) -> Notification: return self.next()

    def _push(self, notification: Notification) -> None:
        try:
            matches = self._filter is None or self._filter(notification)
        except BaseException as error:
            self._unsubscribe(); self._fail(error); return
        with self._condition:
            if matches and self._failure is None:
                self._values.append(notification); self._condition.notify()

    def _fail(self, error: BaseException) -> None:
        with self._condition:
            if self._failure is None: self._failure = error
            self._condition.notify_all()


def _timeout(value: float | None, name: str, optional: bool = False) -> float | None:
    if value is None and optional: return None
    if value is None or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{name} must be a positive number")
    return value


class HarnessClient:
    def __init__(self, command: str, args: tuple[str, ...], *, cwd: str | None = None,
                 env: dict[str, str] | None = None, request_timeout: float | None = None,
                 shutdown_timeout: float = 1.0, dispose_eof_grace_timeout: float = 6.0,
                 dispose_grace_timeout: float = 3.0) -> None:
        self.command, self.args, self.cwd, self.env = command, args, cwd, env
        self.request_timeout = _timeout(request_timeout, "request_timeout", True)
        self.shutdown_timeout = _timeout(shutdown_timeout, "shutdown_timeout")
        self.dispose_eof_grace_timeout = _timeout(dispose_eof_grace_timeout, "dispose_eof_grace_timeout")
        self.dispose_grace_timeout = _timeout(dispose_grace_timeout, "dispose_grace_timeout")
        self._process: subprocess.Popen[str] | None = None
        self._next_id = self._subscription_serial = 0
        self._lock, self._write_lock = threading.Lock(), threading.Lock()
        self._responses: dict[int, queue.Queue[object]] = {}
        self._callbacks: dict[int, Callable[[Notification], None]] = {}
        self._subscriptions: dict[int, NotificationSubscription] = {}
        self._session_parents: dict[str, str] = {}
        self._stderr: deque[str] = deque(maxlen=200)
        self._closed = False
        self._terminal_failure: BaseException | None = None
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if self._closed: raise TransportClosedError("Seal Harness SDK client is closed")
        if self._process is not None: return
        self._process = subprocess.Popen([self.command, *self.args], cwd=self.cwd, env=self.env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1)
        self._threads = [threading.Thread(target=self._read_stdout, daemon=True),
                         threading.Thread(target=self._read_stderr, daemon=True)]
        for thread in self._threads: thread.start()

    def request(self, method: str, params: dict[str, Any] | None = None, *,
                on_notification: Callable[[Notification], None] | None = None,
                timeout: float | None = None) -> Any:
        effective_timeout = self.request_timeout if timeout is None else _timeout(timeout, "timeout")
        self.start()
        process = self._process
        if process is None or process.stdin is None: raise TransportClosedError("Seal Harness RPC is unavailable")
        with self._lock:
            request_id = self._next_id; self._next_id += 1
            result: queue.Queue[object] = queue.Queue(maxsize=1)
            self._responses[request_id] = result
            if on_notification is not None: self._callbacks[request_id] = on_notification
        try:
            with self._write_lock:
                process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}) + "\n")
                process.stdin.flush()
            try: value = result.get(timeout=effective_timeout)
            except queue.Empty as error: raise TimeoutError(f"RPC {method} timed out{self._diagnostics()}") from error
            if isinstance(value, BaseException): raise value
            return value
        finally:
            with self._lock:
                self._responses.pop(request_id, None); self._callbacks.pop(request_id, None)

    def subscribe(self, filter: NotificationFilter | None = None) -> NotificationSubscription:
        with self._lock:
            key = self._subscription_serial; self._subscription_serial += 1
            subscription = NotificationSubscription(lambda: self._remove_subscription(key), filter)
            failure = self._terminal_failure
            if not self._closed and failure is None: self._subscriptions[key] = subscription
        if self._closed or failure is not None:
            subscription._fail(failure or TransportClosedError("Seal Harness SDK client closed"))
        return subscription

    def subscribe_session_tree(self, session_id: str) -> NotificationSubscription:
        def belongs(notification: Notification) -> bool:
            params = notification.params
            if notification.method in ("subagent.started", "subagent.finished"):
                parent = params.get("parentSessionId")
                return (isinstance(parent, str) and self._is_descendant(parent, session_id)) or params.get("childSessionId") == session_id
            candidate = params.get("sessionId")
            return isinstance(candidate, str) and self._is_descendant(candidate, session_id)
        return self.subscribe(belongs)

    def close(self) -> None:
        with self._lock:
            if self._closed: return
            self._closed = True
        process = self._process
        if process is None: self._close_subscriptions(); return
        try: self._request_while_closing("shutdown", self.shutdown_timeout)
        except BaseException: pass
        if process.stdin is not None:
            try: process.stdin.close()
            except OSError: pass
        if not self._wait(process, self.dispose_eof_grace_timeout):
            exited = False
            if os.name != "nt": process.terminate(); exited = self._wait(process, self.dispose_grace_timeout)
            if not exited:
                process.kill()
                if not self._wait(process, self.dispose_grace_timeout):
                    raise TimeoutError("runtime process did not exit after forced termination")
        for stream in (process.stdout, process.stderr):
            if stream is not None: stream.close()
        for thread in self._threads: thread.join(timeout=0.5)
        self._threads.clear(); self._process = None
        failure = TransportClosedError("Seal Harness SDK client closed")
        self._terminal_failure = failure; self._fail_all(failure); self._close_subscriptions()

    def _request_while_closing(self, method: str, timeout: float) -> Any:
        self._closed = False
        try: return self.request(method, timeout=timeout)
        finally: self._closed = True

    @staticmethod
    def _wait(process: subprocess.Popen[str], timeout: float) -> bool:
        try: process.wait(timeout=timeout); return True
        except subprocess.TimeoutExpired: return False

    def _read_stdout(self) -> None:
        process = self._process
        assert process is not None and process.stdout is not None
        try:
            for line in process.stdout:
                try: value = json.loads(line)
                except json.JSONDecodeError: continue
                if not isinstance(value, dict): continue
                if isinstance(value.get("method"), str) and isinstance(value.get("params"), dict):
                    notification = Notification(value["method"], value["params"])
                    self._record_session_relationship(notification)
                    with self._lock:
                        subscriptions = list(self._subscriptions.values())
                        request_id = notification.params.get("requestId")
                        callback = self._callbacks.get(request_id) if isinstance(request_id, int) else None
                    for subscription in subscriptions: subscription._push(notification)
                    if callback is not None: callback(notification)
                    continue
                request_id = value.get("id")
                with self._lock: response = self._responses.get(request_id) if isinstance(request_id, int) else None
                if response is not None:
                    error = value.get("error")
                    if isinstance(error, str): response.put(JsonRpcError(error + self._diagnostics()))
                    elif isinstance(error, dict) and isinstance(error.get("message"), str): response.put(JsonRpcError(error["message"] + self._diagnostics()))
                    else: response.put(value.get("result"))
        finally:
            failure = TransportClosedError("Seal Harness RPC closed" + self._diagnostics())
            self._terminal_failure = failure; self._fail_all(failure); self._fail_subscriptions(failure)

    def _read_stderr(self) -> None:
        process = self._process
        assert process is not None and process.stderr is not None
        for line in process.stderr: self._stderr.append(line)

    def _remove_subscription(self, key: int) -> None:
        with self._lock: self._subscriptions.pop(key, None)

    def _record_session_relationship(self, notification: Notification) -> None:
        if notification.method != "subagent.started": return
        parent, child = notification.params.get("parentSessionId"), notification.params.get("childSessionId")
        if isinstance(parent, str) and parent and isinstance(child, str) and child and parent != child:
            with self._lock: self._session_parents[child] = parent

    def _is_descendant(self, session_id: str, root: str) -> bool:
        visited: set[str] = set(); current = session_id
        while current not in visited:
            if current == root: return True
            visited.add(current)
            with self._lock: parent = self._session_parents.get(current)
            if parent is None: return False
            current = parent
        return False

    def _fail_all(self, error: BaseException) -> None:
        with self._lock: responses = list(self._responses.values())
        for response in responses:
            try: response.put_nowait(error)
            except queue.Full: pass

    def _fail_subscriptions(self, error: BaseException) -> None:
        with self._lock: subscriptions = list(self._subscriptions.values())
        for subscription in subscriptions: subscription._fail(error)

    def _close_subscriptions(self) -> None:
        with self._lock: subscriptions = list(self._subscriptions.values())
        for subscription in subscriptions: subscription.close()

    def _diagnostics(self) -> str:
        text = "".join(self._stderr).strip()
        return "" if not text else f"\nRPC stderr:\n{text}"
