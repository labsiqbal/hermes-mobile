"""Isolated publication seam tests: temporary trees and injected HTTP/route reads."""
import hashlib
import importlib.util
import io
import json
from contextlib import redirect_stdout
from http.client import HTTPResponse
from unittest.mock import Mock, patch
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, build_opener


SPEC = importlib.util.spec_from_file_location(
    "publish_static", Path(__file__).with_name("publish-static.py"))
assert SPEC is not None and SPEC.loader is not None
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def http_transport(respond):
    """Inject HTTP responses, retaining urllib's real status/redirect handling."""
    class FixtureHTTPSHandler(HTTPSHandler):
        def https_open(self, req):
            code, data = respond(req.full_url)
            headers = f"HTTP/1.1 {code} fixture\r\nContent-Length: {len(data)}\r\n"
            if code != 200:
                headers += "Location: /./\r\n"
            sock = Mock()
            sock.makefile.return_value = io.BytesIO((headers + "\r\n").encode() + data)
            response = HTTPResponse(sock)
            response.begin()
            response.url = req.full_url
            return response

    return patch.object(publisher, "build_opener", side_effect=lambda *handlers:
                        build_opener(*handlers, FixtureHTTPSHandler()))


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "live"
        self.artifact = self.base / "approved"
        self.root.mkdir()
        self.artifact.mkdir()
        self.old = {"index.html": b"old entry", "assets/old-12345678.js": b"old lazy",
                    "logo.png": b"stable"}
        self.new = {"index.html": b"new entry", "assets/new-abcdefgh.js": b"new JS",
                    "logo.png": b"stable"}
        for tree, files in ((self.root, self.old), (self.artifact, self.new)):
            for name, data in files.items():
                path = tree / name
                path.parent.mkdir(exist_ok=True, parents=True)
                path.write_bytes(data)
        self.manifest = self.base / "manifest.json"
        self.freeze()
        self.route = {"Web": {"nuc.tailcf7779.ts.net:8451": {
            "Handlers": {"/": {"Path": str(self.root)},
                         "/api": {"Proxy": "redacted-for-test"}}}}}
        self.route_sha = sha(json.dumps(self.route, sort_keys=True,
                                       separators=(",", ":")).encode())
        self.health = {"version": "test", "gateway_running": True,
                       "gateway_state": "running", "overall": "ok",
                       "auth_required": True, "auth_providers": ["basic"]}
        self.requests = []

    def freeze(self, manifest=None):
        if manifest is None:
            manifest = {name: sha(data) for name, data in self.new.items()}
        self.manifest.write_text(json.dumps(manifest, sort_keys=True))
        self.manifest_sha = sha(self.manifest.read_bytes())

    def snapshot(self):
        return {str(p.relative_to(self.root)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.root.rglob("*") if p.is_file()}

    def fetch(self, url):
        path = urlsplit(url).path
        self.requests.append((path, (self.root / "index.html").read_bytes()))
        if path == "/api/status":
            return json.dumps(self.health).encode()
        return (self.root / (path.lstrip("/") or "index.html")).read_bytes()

    def run_release(self, publish=False, **overrides):
        args = dict(artifact=self.artifact, manifest=self.manifest,
                    manifest_sha256=self.manifest_sha, root=self.root,
                    expected_entry_sha256=sha(self.old["index.html"]),
                    expected_route_sha256=self.route_sha, publish=publish,
                    fetch=self.fetch, read_route=lambda: self.route)
        args.update(overrides)
        return publisher.run_release(**args)

    def test_default_dry_run_does_not_mutate_target(self):
        before = self.snapshot()
        receipt = self.run_release()
        self.assertEqual(receipt["status"], "dry_run")
        self.assertEqual(receipt["planned_additions"], 1)
        self.assertFalse(receipt["entry_replaced"])
        self.assertEqual(before, self.snapshot())
        self.assertFalse((self.root / "assets/new-abcdefgh.js").exists())

    def test_redirecting_index_alias_is_not_required_for_dry_run_or_publication(self):
        urls = []

        def redirect_alias(url):
            urls.append((url, (self.root / "index.html").read_bytes()))
            if urlsplit(url).path == "/index.html":
                return 301, b"index alias redirects"
            return 200, self.fetch(url)

        before = self.snapshot()
        with http_transport(redirect_alias):
            receipt = self.run_release(fetch=publisher.https_fetch)
            self.assertEqual(receipt["status"], "dry_run", receipt)
            self.assertEqual(before, self.snapshot())
            receipt = self.run_release(publish=True, fetch=publisher.https_fetch)
            self.assertEqual(receipt["status"], "published", receipt)
        self.assertFalse(any(urlsplit(url).path == "/index.html" for url, _ in urls))
        expected_roots = []
        # Dry-run, publication preflight, pre-switch, then post-switch.
        for entry in (b"old entry", b"old entry", b"old entry", b"new entry"):
            expected_roots.extend([(publisher.ORIGIN + "/", entry),
                                   (publisher.ORIGIN + "/?release=" + sha(entry), entry)])
        self.assertEqual([(url, entry) for url, entry in urls
                          if urlsplit(url).path == "/"], expected_roots)
        for name, data in (self.old | self.new).items():
            path = "/" if name == "index.html" else "/" + name
            for suffix in ("", "?release=" + sha(data)):
                self.assertIn((publisher.ORIGIN + path + suffix, b"new entry"), urls)

    def test_root_byte_mismatch_fails_even_with_redirecting_index_alias(self):
        for busted in (False, True):
            with self.subTest(busted=busted):
                def respond(url):
                    parsed = urlsplit(url)
                    if parsed.path == "/index.html":
                        return 301, b"index alias redirects"
                    if parsed.path == "/" and bool(parsed.query) == busted:
                        return 200, b"wrong entry bytes"
                    return 200, self.fetch(url)

                before = self.snapshot()
                with http_transport(respond):
                    receipt = self.run_release(publish=True, fetch=publisher.https_fetch)
                self.assertEqual(receipt["status"], "failed", receipt)
                self.assertEqual(receipt["stage"], "live_preflight")
                self.assertEqual(receipt["error"], "https_bytes_mismatch")
                self.assertFalse(receipt["entry_replaced"])
                self.assertEqual(receipt["assets_added"], 0)
                self.assertEqual(before, self.snapshot())

    def test_redirects_are_never_followed_for_root_assets_or_index_alias(self):
        for path in ("/", "/assets/old-12345678.js", "/assets/new-abcdefgh.js",
                     "/logo.png", "/index.html"):
            for suffix in ("", "?release=" + sha(b"fixture")):
                for status in (301, 302, 303, 307, 308):
                    with self.subTest(path=path, suffix=suffix, status=status):
                        requests = []

                        def redirect(url):
                            requests.append(url)
                            return status, b"redirect body is not file content"

                        url = publisher.ORIGIN + path + suffix
                        with http_transport(redirect):
                            with self.assertRaisesRegex(publisher.Refusal,
                                                        "^https_redirect_rejected$"):
                                publisher.https_fetch(url)
                        self.assertEqual(requests, [url])

    def test_entry_is_last_and_all_old_files_are_retained(self):
        before_mtime = (self.root / "index.html").stat().st_mtime_ns
        receipt = self.run_release(publish=True)
        self.assertEqual(receipt["status"], "published", receipt)
        self.assertTrue(receipt["entry_replaced"])
        self.assertEqual(receipt["assets_added"], 1)
        first_new_fetch = next(entry for path, entry in self.requests
                               if path == "/assets/new-abcdefgh.js")
        self.assertEqual(first_new_fetch, b"old entry")
        for name, data in self.old.items():
            if name != "index.html":
                self.assertEqual((self.root / name).read_bytes(), data)
                self.assertTrue(any(path == "/" + name and entry == b"new entry"
                                    for path, entry in self.requests))
        self.assertGreater((self.root / "index.html").stat().st_mtime_ns // 10**9,
                           before_mtime // 10**9)
        self.assertEqual(set(self.snapshot()), set(self.old) | set(self.new))

    def test_failed_pre_entry_fetch_preserves_old_entry_and_reports_assets(self):
        def fail_added(url):
            if urlsplit(url).path == "/assets/new-abcdefgh.js":
                return b"wrong cached bytes"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=fail_added)
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["stage"], "verifying_assets_before_entry")
        self.assertEqual(receipt["error"], "https_bytes_mismatch")
        self.assertEqual(receipt["assets_added"], 1)
        self.assertFalse(receipt["entry_replaced"])
        self.assertEqual((self.root / "index.html").read_bytes(), b"old entry")
        self.assertEqual((self.root / "assets/new-abcdefgh.js").read_bytes(), b"new JS")

    def test_failed_post_switch_fetch_does_not_claim_rollback(self):
        def stale_root(url):
            if urlsplit(url).path == "/" and (self.root / "index.html").read_bytes() == b"new entry":
                return b"stale entry"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=stale_root)
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["stage"], "post_switch_verification")
        self.assertTrue(receipt["entry_replaced"])
        self.assertEqual((self.root / "index.html").read_bytes(), b"new entry")
        self.assertEqual(set(self.snapshot()), set(self.old) | set(self.new))

    def test_manifest_coverage_mismatch_is_read_only(self):
        self.freeze({"index.html": sha(b"new entry")})
        before = self.snapshot()
        receipt = self.run_release(publish=True)
        self.assertEqual(receipt["error"], "manifest_coverage_mismatch")
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.requests, [])

    def test_manifest_hash_mismatch_is_read_only(self):
        (self.artifact / "index.html").write_bytes(b"changed after approval")
        before = self.snapshot()
        self.assertEqual(self.run_release(publish=True)["error"], "artifact_hash_mismatch")
        self.assertEqual(before, self.snapshot())

    def test_manifest_itself_must_match_approval_digest(self):
        self.manifest.write_text("{}")
        self.assertEqual(self.run_release()["error"], "manifest_digest_mismatch")

    def test_manifest_unsafe_paths_are_rejected(self):
        for name in ("../escape", "/absolute", "assets//a.js", "a/../b", "a\\b", ".hidden"):
            with self.subTest(name=name):
                self.freeze({name: sha(b"anything"), "index.html": sha(b"new entry")})
                before = self.snapshot()
                self.assertEqual(self.run_release(publish=True)["error"], "unsafe_manifest_path")
                self.assertEqual(before, self.snapshot())

    def test_duplicate_manifest_key_is_rejected(self):
        self.manifest.write_text('{"index.html":"' + sha(b"new entry") +
                                 '","index.html":"' + sha(b"new entry") + '"}')
        self.manifest_sha = sha(self.manifest.read_bytes())
        self.assertEqual(self.run_release()["error"], "duplicate_json_key")

    def test_artifact_symlink_is_rejected(self):
        path = self.artifact / "logo.png"
        path.unlink()
        path.symlink_to(self.root / "logo.png")
        self.assertEqual(self.run_release()["error"], "symlink_rejected")

    def test_target_symlink_directory_is_rejected(self):
        (self.root / "unsafe").symlink_to(self.artifact, target_is_directory=True)
        self.assertEqual(self.run_release(publish=True)["error"], "symlink_rejected")
        self.assertEqual((self.root / "index.html").read_bytes(), b"old entry")

    def test_source_ancestor_symlink_is_rejected(self):
        alias = self.base / "alias"
        alias.symlink_to(self.base, target_is_directory=True)
        self.assertEqual(self.run_release(artifact=alias / "approved")["error"], "symlink_rejected")

    def test_source_target_overlap_is_rejected(self):
        self.assertEqual(self.run_release(artifact=self.root)["error"], "source_target_overlap")
        self.assertEqual(self.run_release(artifact=self.root / "candidate")["error"], "source_target_overlap")

    def test_unequal_hashed_collision_is_rejected(self):
        (self.root / "assets/new-abcdefgh.js").write_bytes(b"different preexisting bytes")
        before = self.snapshot()
        self.assertEqual(self.run_release(publish=True)["error"], "asset_collision")
        self.assertEqual(before, self.snapshot())

    def test_stable_support_change_and_new_stable_file_are_rejected(self):
        self.new["logo.png"] = b"new stable logo"
        (self.artifact / "logo.png").write_bytes(self.new["logo.png"])
        self.freeze()
        self.assertEqual(self.run_release()["error"], "stable_support_changed")
        self.new["logo.png"] = b"stable"
        (self.artifact / "logo.png").write_bytes(b"stable")
        self.new["sw.js"] = b"service worker"
        (self.artifact / "sw.js").write_bytes(b"service worker")
        self.freeze()
        self.assertEqual(self.run_release()["error"], "new_stable_support_not_authorized")

    def test_old_entry_and_route_guards_are_mandatory(self):
        self.assertEqual(self.run_release(expected_entry_sha256="0" * 64)["error"], "old_entry_mismatch")
        self.assertEqual(self.run_release(expected_route_sha256="0" * 64)["error"], "route_digest_mismatch")
        self.route["Web"]["nuc.tailcf7779.ts.net:8451"]["Handlers"]["/"] = {"Path": "/wrong"}
        digest = sha(json.dumps(self.route, sort_keys=True, separators=(",", ":")).encode())
        self.assertEqual(self.run_release(expected_route_sha256=digest)["error"], "serving_root_mismatch")

    def test_route_drift_after_switch_is_reported(self):
        def route():
            if (self.root / "index.html").read_bytes() == b"new entry":
                return {"Web": {}}
            return self.route
        receipt = self.run_release(publish=True, read_route=route)
        self.assertEqual(receipt["error"], "route_digest_mismatch")
        self.assertTrue(receipt["entry_replaced"])
        self.assertEqual(receipt["stage"], "post_switch_verification")

    def test_api_drift_after_switch_is_reported(self):
        def fetch(url):
            if (self.root / "index.html").read_bytes() == b"new entry":
                self.health["version"] = "changed"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=fetch)
        self.assertEqual(receipt["error"], "api_health_changed")
        self.assertTrue(receipt["entry_replaced"])

    def test_external_exception_details_are_not_in_receipt(self):
        def fail(url):
            raise RuntimeError("private-token and internal-address must not escape")
        receipt = self.run_release(fetch=fail)
        self.assertEqual(receipt["error"], "external_or_io_failure")
        self.assertNotIn("private-token", json.dumps(receipt))
        self.assertNotIn("internal-address", json.dumps(receipt))

    def test_cache_busted_root_is_required(self):
        def stale_busted(url):
            if (urlsplit(url).path == "/" and urlsplit(url).query and
                    (self.root / "index.html").read_bytes() == b"new entry"):
                return b"old entry"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=stale_busted)
        self.assertEqual(receipt["error"], "https_bytes_mismatch")
        self.assertTrue(receipt["entry_replaced"])

    def test_dry_run_rejects_candidate_drift_during_network_checks(self):
        def drift(url):
            result = self.fetch(url)
            (self.artifact / "index.html").write_bytes(b"changed during preflight")
            return result
        receipt = self.run_release(fetch=drift)
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["error"], "artifact_hash_mismatch")
        self.assertFalse(receipt["entry_replaced"])

    def test_every_added_asset_is_verified_before_entry_switch(self):
        name = "assets/second-87654321.js"
        self.new[name] = b"second lazy chunk"
        (self.artifact / name).write_bytes(self.new[name])
        self.freeze()
        def fail_second(url):
            if urlsplit(url).path == "/" + name:
                return b"unavailable second chunk"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=fail_second)
        self.assertEqual(receipt["assets_added"], 2)
        self.assertEqual(receipt["stage"], "verifying_assets_before_entry")
        self.assertFalse(receipt["entry_replaced"])
        self.assertEqual((self.root / "index.html").read_bytes(), b"old entry")

    def test_identical_existing_hashed_asset_is_not_rewritten(self):
        target = self.root / "assets/new-abcdefgh.js"
        target.write_bytes(b"new JS")
        mtime = target.stat().st_mtime_ns
        receipt = self.run_release(publish=True)
        self.assertEqual(receipt["status"], "published", receipt)
        self.assertEqual(receipt["assets_added"], 0)
        self.assertEqual(target.stat().st_mtime_ns, mtime)

    def test_pre_entry_route_drift_preserves_old_entry(self):
        def route():
            if (self.root / "assets/new-abcdefgh.js").exists():
                return {"Web": {}}
            return self.route
        receipt = self.run_release(publish=True, read_route=route)
        self.assertEqual(receipt["error"], "route_digest_mismatch")
        self.assertEqual(receipt["assets_added"], 1)
        self.assertFalse(receipt["entry_replaced"])
        self.assertEqual((self.root / "index.html").read_bytes(), b"old entry")

    def test_retained_old_asset_https_failure_after_switch_is_reported(self):
        def stale_old(url):
            if (urlsplit(url).path == "/assets/old-12345678.js" and
                    (self.root / "index.html").read_bytes() == b"new entry"):
                return b"missing old lazy chunk"
            return self.fetch(url)
        receipt = self.run_release(publish=True, fetch=stale_old)
        self.assertEqual(receipt["stage"], "post_switch_verification")
        self.assertEqual(receipt["error"], "https_bytes_mismatch")
        self.assertTrue(receipt["entry_replaced"])

    def test_manifest_symlink_and_hardlinked_asset_are_rejected(self):
        original = self.base / "original.json"
        self.manifest.rename(original)
        self.manifest.symlink_to(original)
        self.assertEqual(self.run_release()["error"], "symlink_rejected")
        self.manifest.unlink()
        original.rename(self.manifest)
        import os
        os.link(self.artifact / "logo.png", self.base / "hardlink")
        self.assertEqual(self.run_release()["error"], "non_regular_or_hardlinked_file")

    def test_non_normalized_absolute_input_is_rejected(self):
        for artifact in (str(self.artifact) + "/", str(self.base) + "/../approved",
                         str(self.base) + "//approved", "approved"):
            self.assertEqual(self.run_release(artifact=artifact)["error"], "unsafe_absolute_path")

    def test_cli_requires_exact_publish_flag_and_refuses_target_overrides(self):
        args = ["--artifact", str(self.artifact), "--manifest", str(self.manifest),
                "--manifest-sha256", self.manifest_sha,
                "--expected-entry-sha256", sha(b"old entry"),
                "--expected-route-sha256", self.route_sha]
        for extra in (["--pub"], ["--root", str(self.root)],
                      ["--origin", "https://other.invalid"], ["--unknown", "private-token"]):
            with self.subTest(extra=extra), patch.object(publisher, "run_release") as run:
                output = io.StringIO()
                with redirect_stdout(output):
                    code = publisher.main(args + extra)
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output.getvalue())["error"], "invalid_arguments")
                self.assertNotIn("private-token", output.getvalue())
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
