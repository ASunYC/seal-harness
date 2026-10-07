"""运行：python3 .trellis/scripts/tests/test_workflow.py。"""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / ".trellis/scripts"))
from common.config import get_codex_dispatch_mode, get_session_auto_commit


def check_workflow():
    assert get_codex_dispatch_mode(ROOT) == "auto"
    assert get_session_auto_commit(ROOT) is True
    spec = importlib.util.spec_from_file_location(
        "session_start", ROOT / ".codex/hooks/session-start.py"
    )
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    with tempfile.TemporaryDirectory() as temporary:
        trellis = Path(temporary) / ".trellis"
        task = trellis / "tasks/example"
        task.mkdir(parents=True)
        (task / "task.json").write_text(json.dumps({"status": "planning"}))
        (task / "prd.md").write_text("Requirements")
        active = SimpleNamespace(task_path=".trellis/tasks/example", stale=False)
        with patch.object(hook, "_resolve_active_task", return_value=active):
            assert "existing authorization" in hook._get_task_status(trellis, {})
            for name in ("design.md", "implement.md"):
                (task / name).write_text("Plan")
            assert "existing implementation authorization" in hook._get_task_status(trellis, {})
        with patch.object(hook, "_resolve_active_task", return_value=SimpleNamespace(task_path=None)):
            output = hook._get_task_status(trellis, {})
            assert "existing implementation authorization" in output
            assert "ask for task-creation consent" not in output
    for step in ("1.0", "1.1", "1.2", "1.3", "1.4", "2.1", "2.2", "2.3", "3.2", "3.3", "3.4", "3.5"):
        result = subprocess.run(
            [sys.executable, ".trellis/scripts/get_context.py", "--mode", "phase",
             "--step", step, "--platform", "codex"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        assert step in result.stdout, result.stdout
    print("Trellis defaults, authorization prompts and 12 workflow steps: PASS")


if __name__ == "__main__":
    check_workflow()
