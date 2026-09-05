#!/usr/bin/env python3
"""Bounded, additive publisher for the existing Hermes Mobile static mount.

CLI fixes the production boundary. run_release exposes only filesystem/HTTP/route
seams for isolated tests. No build, configuration changes, pruning or rollback.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path("/home/iqbal/workspace/personal/hermes-mobile/app/dist")
ORIGIN = "https://nuc.tailcf7779.ts.net:8451"
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\Z")
HASHED_ASSET = re.compile(r"assets/[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+\Z")
HEALTH_FIELDS = ("version", "gateway_running", "gateway_state", "overall",
                 "auth_required", "auth_providers")


class Refusal(Exception):
    """Only fixed, non-sensitive error codes may leave this boundary."""


def require(condition, code):
    if not condition:
        raise Refusal(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def safe_path(value):
    raw = os.fspath(value)
    require(raw.startswith("/") and not raw.startswith("//")
            and os.path.normpath(raw) == raw and all(p not in (".", "..")
            for p in raw.split("/")), "unsafe_absolute_path")
    path = Path(raw)
    for part in (path, *path.parents):
        require(not part.is_symlink(), "symlink_rejected")
    return path


def safe_relative(name):
    require(isinstance(name, str) and name and all(
        COMPONENT.fullmatch(p) and p not in (".", "..")
        for p in name.split("/")), "unsafe_manifest_path")


def read_regular(path):
    # O_NOFOLLOW also protects against leaf-link replacement between checks.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                "non_regular_or_hardlinked_file")
        return stream.read()


def tree_hashes(root, *, ignore_stage=None):
    safe_path(root)
    require(root.is_dir(), "missing_directory")
    result = {}

    def walk_failed(error):
        raise Refusal("tree_unreadable")

    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_failed):
        dirs.sort()
        for name in sorted(dirs + files):
            path = Path(directory) / name
            if path == ignore_stage:
                continue
            relative = path.relative_to(root).as_posix()
            safe_relative(relative)
            require(not path.is_symlink(), "symlink_rejected")
            if name in files:
                result[relative] = sha(read_regular(path))
    return dict(sorted(result.items()))


def load_artifact(artifact, manifest, manifest_sha256):
    raw = read_regular(manifest)
    require(sha(raw) == manifest_sha256, "manifest_digest_mismatch")
    frozen = parse_json(raw)
    require(isinstance(frozen, dict) and frozen, "invalid_manifest")
    for name, digest in frozen.items():
        safe_relative(name)
        require(isinstance(digest, str) and SHA256.fullmatch(digest),
                "invalid_manifest_hash")
    actual = tree_hashes(artifact)
    require(set(actual) == set(frozen), "manifest_coverage_mismatch")
    require(actual == frozen, "artifact_hash_mismatch")
    require("index.html" in frozen, "missing_entry")
    return dict(sorted(frozen.items()))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Refusal("https_redirect_rejected")


def https_fetch(url):
    require(url.startswith(ORIGIN + "/"), "origin_boundary")
    # No environment proxy, cookies, credentials or redirect-following.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    request = Request(url, headers={"Cache-Control": "no-cache",
                                   "Accept-Encoding": "identity"})
    try:
        with opener.open(request, timeout=20) as response:
            require(response.status == 200 and response.url == url,
                    "https_status_or_url_mismatch")
            return response.read()
    except Refusal:
        raise
    except Exception:
        raise Refusal("https_fetch_failed") from None


def read_serve_route():
    try:
        result = subprocess.run(["tailscale", "serve", "status", "--json"],
                                capture_output=True, check=True, timeout=20)
        return parse_json(result.stdout)
    except Exception:
        raise Refusal("route_read_failed") from None


def guard_route(read_route, root, expected):
    route = read_route()
    digest = sha(json.dumps(route, sort_keys=True, separators=(",", ":")).encode())
    require(digest == expected, "route_digest_mismatch")
    handler = route.get("Web", {}).get(urlsplit(ORIGIN).netloc, {}).get(
        "Handlers", {}).get("/", {})
    require(handler == {"Path": str(root)}, "serving_root_mismatch")


def check_health(fetch):
    status = parse_json(fetch(ORIGIN + "/api/status"))
    require(isinstance(status, dict) and all(k in status for k in HEALTH_FIELDS),
            "api_health_shape_mismatch")
    require(status["gateway_running"] is True and status["gateway_state"] == "running"
            and status["overall"] == "ok" and status["auth_required"] is True,
            "api_unhealthy")
    return {k: status[k] for k in HEALTH_FIELDS}


def verify_files(fetch, files):
    for name, digest in sorted(files.items()):
        # The static server redirects /index.html; verify the exact entry bytes
        # at canonical / instead. This does not permit following any redirects.
        path = "/" if name == "index.html" else "/" + name
        for suffix in ("", "?release=" + digest):
            require(sha(fetch(ORIGIN + path + suffix)) == digest,
                    "https_bytes_mismatch")


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def stage_file(destination, data, mtime_ns=None):
    fd, name = tempfile.mkstemp(prefix=".publish-", dir=destination.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
            if mtime_ns is not None:
                os.utime(stream.fileno(), ns=(mtime_ns, mtime_ns))
            os.fsync(stream.fileno())
        return staged
    except BaseException:
        staged.unlink()
        raise


def run_release(*, artifact, manifest, manifest_sha256, expected_entry_sha256,
                expected_route_sha256, root=ROOT, publish=False,
                fetch=https_fetch, read_route=read_serve_route):
    """Return a sanitized receipt even on failure; never automatically restore.

    Inject root/fetch/read_route only for isolated tests. CLI forbids target and
    origin overrides. Directory flock serializes instances without a lock file.
    """
    receipt = {"status": "failed", "mode": "publish" if publish else "dry_run",
               "stage": "input_validation", "entry_replaced": False,
               "assets_added": 0, "planned_additions": 0,
               "retained_files": 0, "error": None}
    lock_fd = None
    staged = None
    try:
        for value in (manifest_sha256, expected_entry_sha256, expected_route_sha256):
            require(isinstance(value, str) and SHA256.fullmatch(value), "invalid_guard_hash")
        artifact, manifest, root = map(safe_path, (artifact, manifest, root))
        require(artifact != root and artifact not in root.parents and root not in artifact.parents,
                "source_target_overlap")
        require(artifact not in manifest.parents and root not in manifest.parents,
                "manifest_inside_tree")
        frozen = load_artifact(artifact, manifest, manifest_sha256)
        require(root.is_dir(), "missing_directory")
        require(not os.path.samefile(artifact, root), "source_target_overlap")
        lock_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        root_identity = os.fstat(lock_fd)
        old = tree_hashes(root)
        require(old.get("index.html") == expected_entry_sha256, "old_entry_mismatch")
        additions = {}
        for name, digest in frozen.items():
            if name == "index.html":
                continue
            if name in old:
                require(old[name] == digest, "asset_collision" if HASHED_ASSET.fullmatch(name)
                        else "stable_support_changed")
            else:
                require(HASHED_ASSET.fullmatch(name), "new_stable_support_not_authorized")
                require((root / name).parent.is_dir(), "new_asset_directory_not_authorized")
                additions[name] = digest
        retained = {name: digest for name, digest in old.items() if name != "index.html"}
        receipt.update(manifest_sha256=manifest_sha256,
                       expected_entry_sha256=expected_entry_sha256,
                       new_entry_sha256=frozen["index.html"],
                       route_sha256=expected_route_sha256,
                       planned_additions=len(additions), retained_files=len(retained))
        receipt["stage"] = "live_preflight"
        guard_route(read_route, root, expected_route_sha256)
        baseline_health = check_health(fetch)
        verify_files(fetch, old)

        def guard_disk(expected, *, ignore_stage=None):
            current = root.stat()
            require((current.st_dev, current.st_ino) ==
                    (root_identity.st_dev, root_identity.st_ino), "root_identity_changed")
            require(tree_hashes(root, ignore_stage=ignore_stage) == expected, "target_drift")

        guard_disk(old)
        if not publish:
            guard_route(read_route, root, expected_route_sha256)
            require(check_health(fetch) == baseline_health, "api_health_changed")
            require(load_artifact(artifact, manifest, manifest_sha256) == frozen, "artifact_changed")
            guard_disk(old)
            receipt.update(status="dry_run", stage="dry_run_complete")
            return receipt

        receipt["stage"] = "adding_assets"
        expected_tree = old.copy()
        for name, digest in additions.items():
            guard_disk(expected_tree)
            data = read_regular(artifact / name)
            require(sha(data) == digest, "artifact_changed")
            destination = root / name
            staged = stage_file(destination, data)
            # link is atomic and NO-CLOBBER, unlike rename/replace. Remove only
            # our temporary name, never an old asset or an old HTML backup.
            os.link(staged, destination, follow_symlinks=False)
            receipt["assets_added"] += 1
            expected_tree[name] = digest
            staged.unlink()
            staged = None
            fsync_directory(destination.parent)

        receipt["stage"] = "verifying_assets_before_entry"
        verify_files(fetch, additions)
        # Revalidate the complete candidate and live tree after network I/O.
        require(load_artifact(artifact, manifest, manifest_sha256) == frozen, "artifact_changed")
        guard_disk(old | additions)
        guard_route(read_route, root, expected_route_sha256)
        require(check_health(fetch) == baseline_health, "api_health_changed")
        verify_files(fetch, old)
        receipt["stage"] = "switching_entry"
        data = read_regular(artifact / "index.html")
        require(sha(data) == frozen["index.html"], "artifact_changed")
        entry = root / "index.html"
        next_second = (entry.stat().st_mtime_ns // 1_000_000_000 + 1) * 1_000_000_000
        staged = stage_file(entry, data, max(time.time_ns(), next_second))
        # Temporary file is excluded from this final drift check, but all
        # previously served files must still match immediately before replace.
        guard_disk(old | additions, ignore_stage=staged)
        guard_route(read_route, root, expected_route_sha256)
        os.replace(staged, entry)
        receipt["entry_replaced"] = True
        staged = None
        fsync_directory(root)
        receipt["stage"] = "post_switch_verification"
        verify_files(fetch, frozen)
        verify_files(fetch, retained)
        guard_disk(old | frozen)
        guard_route(read_route, root, expected_route_sha256)
        require(check_health(fetch) == baseline_health, "api_health_changed")
        receipt.update(status="published", stage="complete")
    except Refusal as exc:
        receipt["error"] = str(exc)
    except (Exception, KeyboardInterrupt):
        # Never emit exceptions, HTTP bodies, route JSON, argv or local paths.
        receipt["error"] = "external_or_io_failure"
    finally:
        if staged is not None:
            try:
                staged.unlink()
            except OSError:
                receipt["temporary_cleanup_failed"] = True
        if lock_fd is not None:
            os.close(lock_fd)
    return receipt


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal("invalid_arguments")


def main(argv=None):
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--artifact", required=True, help="Absolute approved build directory")
    parser.add_argument("--manifest", required=True, help="Absolute frozen JSON manifest, outside both trees")
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--expected-entry-sha256", required=True)
    parser.add_argument("--expected-route-sha256", required=True)
    parser.add_argument("--publish", action="store_true", help="Explicitly enable static writes")
    try:
        args = parser.parse_args(argv)
        receipt = run_release(**vars(args))
    except Refusal:
        receipt = {"status": "failed", "stage": "arguments", "error": "invalid_arguments",
                   "entry_replaced": False, "assets_added": 0}
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
    return 0 if receipt["status"] in ("dry_run", "published") else 1


if __name__ == "__main__":
    raise SystemExit(main())
