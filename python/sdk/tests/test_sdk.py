from __future__ import annotations

import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

from seal_harness import HarnessClient, SealHarness, SealHarnessConfig, TransportClosedError


FAKE_RPC = textwrap.dedent(r"""
    import json, sys
    for line in sys.stdin:
        request = json.loads(line)
        if request.get("jsonrpc") != "2.0":
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32600, "message": "missing JSON-RPC version"}}), flush=True)
            continue
        if request["method"] == "initialize":
            print(json.dumps({"id": request["id"], "result": {"serverInfo": {"name": "fake", "version": "1"}}}), flush=True)
        elif request["method"] == "prompt":
            params = request["params"]
            event = {"type": "text_delta", "delta": "python-ok:" + params["prompt"]}
            print(json.dumps({"method": "event", "params": {"requestId": request["id"], "sessionId": params["sessionId"], "event": event}}), flush=True)
            print(json.dumps({"id": request["id"], "result": {"sessionId": params["sessionId"], "runId": "run-python", "stopReason": "stop"}}), flush=True)
        elif request["method"] == "shutdown":
            print(json.dumps({"id": request["id"], "result": {"stopped": True}}), flush=True)
            break
""")

RETRY_RPC = textwrap.dedent(r"""
    import json, pathlib, sys
    marker = pathlib.Path(sys.argv[1])
    for line in sys.stdin:
        request = json.loads(line)
        if request["method"] == "initialize":
            if not marker.exists():
                marker.write_text("failed")
                print(json.dumps({"id": request["id"], "error": "first initialization fails"}), flush=True)
            else:
                print(json.dumps({"id": request["id"], "result": {"ok": True}}), flush=True)
        elif request["method"] == "shutdown":
            print(json.dumps({"id": request["id"], "result": {"stopped": True}}), flush=True)
            break
""")

NOTIFICATION_RPC = textwrap.dedent(r"""
    import json, sys
    for line in sys.stdin:
        request = json.loads(line)
        if request["method"] == "emit":
            print(json.dumps({"method": "subagent.started", "params": {"parentSessionId": "root", "childSessionId": "child"}}), flush=True)
            print(json.dumps({"method": "event", "params": {"sessionId": "child", "value": 1}}), flush=True)
            print(json.dumps({"method": "event", "params": {"sessionId": "other", "value": 2}}), flush=True)
            print(json.dumps({"id": request["id"], "result": {"ok": True}}), flush=True)
        elif request["method"] == "shutdown":
            print(json.dumps({"id": request["id"], "result": {"stopped": True}}), flush=True)
            break
""")

STUBBORN_RPC = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)"


class SealHarnessSdkTest(unittest.TestCase):
    def test_deepseek_harness_compatible_initialization_options(self) -> None:
        runtime = textwrap.dedent(r"""
            import json, sys
            initialized = False
            for line in sys.stdin:
                request = json.loads(line)
                if request["method"] == "initialize":
                    params = request["params"]
                    initialized = params == {"cwd": params["cwd"], "provider": "fixture", "model": "model", "reasoningEffort": "high", "maxTokens": 2048}
                    print(json.dumps({"id": request["id"], "result": {"serverInfo": {"name": "fake", "version": "1"}}}), flush=True)
                elif request["method"] == "prompt":
                    params = request["params"]
                    value = "compatible" if initialized and params.get("reasoning") == "high" and params.get("maxTokens") == 2048 else "mismatch"
                    print(json.dumps({"method": "event", "params": {"requestId": request["id"], "sessionId": params["sessionId"], "event": {"type": "text_delta", "delta": value}}}), flush=True)
                    print(json.dumps({"id": request["id"], "result": {"sessionId": params["sessionId"], "runId": "run", "stopReason": "stop"}}), flush=True)
                elif request["method"] == "shutdown":
                    print(json.dumps({"id": request["id"], "result": {"stopped": True}}), flush=True)
                    break
        """)
        with SealHarness(SealHarnessConfig(command=sys.executable, args=("-u", "-c", runtime), provider="fixture", model="model", reasoning_effort="high", max_tokens=2048)) as harness:
            self.assertEqual(harness.run("hello").final_response, "compatible")
        with self.assertRaisesRegex(ValueError, "positive integer"):
            SealHarness(SealHarnessConfig(max_tokens=0))

    def test_run_reuse_notifications_and_close(self) -> None:
        harness = SealHarness(SealHarnessConfig(
            command=sys.executable,
            args=("-u", "-c", FAKE_RPC),
            provider="fixture",
            model="fixture",
        ))
        notifications = []
        try:
            session = harness.session("stable-python")
            first = session.run("one", on_notification=notifications.append)
            second = session.run("two")
            self.assertEqual(first.session_id, "stable-python")
            self.assertEqual(first.run_id, "run-python")
            self.assertEqual(first.final_response, "python-ok:one")
            self.assertEqual(first.finish_reason, "stop")
            self.assertEqual(second.final_response, "python-ok:two")
            self.assertEqual([item.method for item in notifications], ["event"])
        finally:
            harness.close()
        with self.assertRaises(TransportClosedError):
            harness.start()

    def test_failed_initialization_can_retry_with_a_fresh_process(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "attempted"
            harness = SealHarness(SealHarnessConfig(
                command=sys.executable, args=("-u", "-c", RETRY_RPC, str(marker)),
                dispose_eof_grace_timeout=0.1, dispose_grace_timeout=0.1,
            ))
            try:
                with self.assertRaisesRegex(Exception, "first initialization fails"):
                    harness.start()
                harness.start()
            finally:
                harness.close()

    def test_independent_and_session_tree_subscriptions(self) -> None:
        client = HarnessClient(sys.executable, ("-u", "-c", NOTIFICATION_RPC))
        events = client.subscribe(lambda item: item.method == "event")
        tree = client.subscribe_session_tree("root")
        try:
            client.request("emit", timeout=2)
            self.assertEqual(events.next(1).params["value"], 1)
            self.assertEqual(events.next(1).params["value"], 2)
            self.assertEqual(tree.next(1).method, "subagent.started")
            self.assertEqual(tree.next(1).params["value"], 1)
            self.assertIsNone(tree.try_next())
        finally:
            client.close()
        with self.assertRaises(TransportClosedError):
            events.next()

    def test_close_force_reaps_a_stubborn_process(self) -> None:
        client = HarnessClient(
            sys.executable, ("-u", "-c", STUBBORN_RPC),
            shutdown_timeout=0.05, dispose_eof_grace_timeout=0.05, dispose_grace_timeout=0.2,
        )
        client.start()
        process = client._process
        started = time.monotonic()
        client.close()
        self.assertLess(time.monotonic() - started, 2)
        self.assertIsNotNone(process)
        self.assertIsNotNone(process.poll())

    def test_timeout_validation_and_terminal_close(self) -> None:
        with self.assertRaises(ValueError):
            HarnessClient(sys.executable, (), shutdown_timeout=0)
        client = HarnessClient(sys.executable, ())
        client.close()
        client.close()
        with self.assertRaises(TransportClosedError):
            client.start()


if __name__ == "__main__":
    unittest.main()
