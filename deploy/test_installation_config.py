"""Operator configuration must fail closed before publication starts."""
import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "publisher_config", Path(__file__).with_name("publish-static.py"))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.config = self.home / ".config/hermes-mobile/publisher.json"
        self.config.parent.mkdir(parents=True)
        self.home_patch = patch.object(publisher.Path, "home", return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)

    def write(self, value):
        self.config.write_text(json.dumps(value))
        self.config.chmod(0o600)

    def test_loads_private_target_without_network_access(self):
        root = self.home / "live"
        self.write({"root": str(root), "origin": "https://gateway.example.invalid:8451"})
        self.assertEqual(publisher.load_installation(),
                         (root, "https://gateway.example.invalid:8451"))

    def test_rejects_invalid_origins_and_roots(self):
        for origin in ("http://gateway.invalid", "https://user:password@gateway.invalid",
                       "https://gateway.invalid/", "https://gateway.invalid?token=x",
                       "https://gateway.invalid#fragment", "https://gateway.invalid:bad",
                       "https://gateway.invalid:99999", "https://gateway.invalid\n",
                       "https://", "https://gateway.invalid\\other"):
            with self.subTest(origin=origin):
                self.write({"root": str(self.home / "live"), "origin": origin})
                with self.assertRaises(publisher.Refusal):
                    publisher.load_installation()
        self.write({"root": "relative", "origin": "https://gateway.invalid"})
        with self.assertRaises(publisher.Refusal):
            publisher.load_installation()

    def test_missing_malformed_or_public_config_cannot_start_release(self):
        args = ["--artifact", str(self.home / "artifact"),
                "--manifest", str(self.home / "manifest"),
                "--manifest-sha256", "a" * 64,
                "--expected-entry-sha256", "b" * 64,
                "--expected-route-sha256", "c" * 64, "--publish"]
        for state in ("missing", "malformed", "public"):
            with self.subTest(state=state):
                if state == "malformed":
                    self.config.write_text("private-unparseable-content")
                elif state == "public":
                    self.write({"root": str(self.home / "live"),
                                "origin": "https://gateway.invalid"})
                    self.config.chmod(0o644)
                output = io.StringIO()
                with patch.object(publisher, "run_release") as run, redirect_stdout(output):
                    code = publisher.main(args)
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output.getvalue())["error"], "installation_config_invalid")
                self.assertNotIn("private-unparseable-content", output.getvalue())
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
