#!/usr/bin/env python3
"""hermes-relay-daemon — headless Bot Mode relay (agent-to-agent across gateways).

Replicates the orchestration the Hermes Desktop Electron plugin runs in
``apps/desktop/src/plugins/hermes-bots/plugin.js`` (the ``startBotRelay``
block), so cross-connection ``message_agent`` delivery keeps working 24/7
without the Desktop app — a prerequisite for the mobile app.

Two loops, same semantics as the Desktop relay:

- **Roster loop** (every 60s): per live connection, RPC ``profiles.list``,
  build the union roster of agents on the OTHER connections, push it via
  ``bot_relay.roster.sync``. Fetch failures are fail-soft: the last good rows
  for that connection are reused so a transient blip never reads as
  "everyone on that machine went away" (the gateway-side liveness check
  treats absence from a fresh roster as definitively offline).
  Skipped when fewer than 2 connections are live.

- **Drain loop**: triggered by the gateway's push event
  ``bot_relay.outbox.pending`` (debounced ~250ms) plus a 30s poll backstop.
  Per live connection: ``bot_relay.outbox.drain`` (atomic claim via rename,
  so this daemon and a running Desktop can coexist), then per envelope
  ``bot_relay.deliver`` on the target connection's own socket, then
  ``bot_relay.reply`` back to the sender with the reply or a typed error
  (``error.data.reason`` from a failed deliver is forwarded verbatim).

Unlike the Desktop plugin, the drain still runs with a SINGLE live
connection so envelopes aimed at offline connections get their
``runtime_offline`` error reply promptly instead of waiting out the TTL.

Transport/auth: newline-delimited JSON-RPC over ``ws://host/api/ws``. The
server is gated (non-loopback bind), so each dial does:
  1. authenticate — either a locally minted HMAC bearer token (when
     ``dashboard.basic_auth.secret`` is configured; same token format the
     ``dashboard_auth/basic`` plugin mints, verified by the gate's bearer
     path) or the canonical ``POST /auth/password-login`` (when a plaintext
     ``dashboard.basic_auth.password`` exists), then
  2. ``POST /api/auth/ws-ticket`` for a single-use 30s ticket, then
  3. connect ``/api/ws?ticket=...`` and wait for the ``gateway.ready`` event.

Credentials are READ from ``$HERMES_HOME/config.yaml`` (section
``dashboard.basic_auth``); secret values are never logged. Reconnects use
exponential backoff (1s → 60s cap), re-authenticate, re-mint the ticket,
and schedule an immediate drain so queued envelopes don't wait.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import signal
import sys
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import websockets
import yaml

log = logging.getLogger("relay")

# ── cadences (mirror the Desktop plugin) ─────────────────────────────────────
ROSTER_INTERVAL_S = 60.0
DRAIN_POLL_INTERVAL_S = 30.0
PUSH_DEBOUNCE_S = 0.250
# bot_relay.deliver can block for a full delivery turn: turn-lock wait
# (bot_mode.turn_wait_seconds, default 120s) + 600s turn timeout, doubled when
# the retry policy re-runs once → worst case ~1320s. Tolerate that plus margin.
DELIVER_TIMEOUT_S = 1400.0
DEFAULT_RPC_TIMEOUT_S = 30.0
RECONNECT_BACKOFF_MIN_S = 1.0
RECONNECT_BACKOFF_MAX_S = 60.0
GATEWAY_PING_INTERVAL_S = 60.0

# Platform-side typed failure codes (tools/bot_failure_reasons.py).
REASON_RUNTIME_OFFLINE = "runtime_offline"
REASON_DELIVERY_TIMEOUT = "delivery_timeout"


class RpcError(Exception):
    """JSON-RPC error response. ``data`` carries typed codes (e.g. reason)."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


class NotConnectedError(Exception):
    """The connection's socket is down; the caller should skip this cycle."""


# ── dashboard basic-auth credentials ──────────────────────────────────────────


class DashboardAuth:
    """Credentials + token minting for a gated ``hermes serve`` dashboard.

    Reads ``dashboard.basic_auth`` from the Hermes config. Two strategies:

    - ``secret`` configured → mint the same HMAC-signed bearer access token
      the ``dashboard_auth/basic`` plugin mints (stateless; the gate's
      ``Authorization: Bearer`` path verifies it via ``verify_session``).
      No rate-limited login endpoint involved.
    - plaintext ``password`` configured → canonical
      ``POST /auth/password-login`` (provider ``basic``) and reuse the
      session cookies it sets.
    """

    def __init__(self, section: dict) -> None:
        self.username = str(section.get("username") or "").strip()
        self._password = str(section.get("password") or "").strip()
        self._secret_raw = str(section.get("secret") or "").strip()
        try:
            self._ttl = int(section.get("session_ttl_seconds") or 12 * 60 * 60)
        except (TypeError, ValueError):
            self._ttl = 12 * 60 * 60
        if not self.username:
            raise ValueError(
                "dashboard.basic_auth.username is not set in the Hermes config"
            )
        if not self._secret_raw and not self._password:
            raise ValueError(
                "dashboard.basic_auth has neither 'secret' nor a plaintext "
                "'password' — the relay daemon needs one of them to "
                "authenticate (only a password_hash is not enough)"
            )

    def _secret_bytes(self) -> bytes:
        """Mirror plugins/dashboard_auth/basic._resolve_secret."""
        raw = self._secret_raw
        for decoder in (base64.b64decode, bytes.fromhex):
            try:
                decoded = decoder(raw)
                if len(decoded) >= 16:
                    return decoded
            except (ValueError, TypeError):
                pass
        return raw.encode("utf-8")

    def _mint_access_token(self) -> str:
        """Same signed-blob format as BasicAuthProvider._mint_session."""
        payload = {
            "sub": self.username,
            "kind": "access",
            "exp": int(time.time()) + self._ttl,
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        sig = hmac.new(self._secret_bytes(), raw, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(raw + sig).decode()

    def mint_ws_ticket(self, base_url: str) -> str:
        """Authenticate and mint a single-use WS ticket. Raises on failure."""
        with httpx.Client(base_url=base_url, timeout=15.0) as client:
            if self._secret_raw:
                resp = client.post(
                    "/api/auth/ws-ticket",
                    headers={"Authorization": f"Bearer {self._mint_access_token()}"},
                )
            else:
                login = client.post(
                    "/auth/password-login",
                    json={
                        "provider": "basic",
                        "username": self.username,
                        "password": self._password,
                    },
                )
                login.raise_for_status()
                resp = client.post("/api/auth/ws-ticket")
            resp.raise_for_status()
            ticket = str(resp.json().get("ticket") or "")
            if not ticket:
                raise RuntimeError("ws-ticket response carried no ticket")
            return ticket


def load_dashboard_auth(hermes_home: Path) -> DashboardAuth:
    cfg_path = hermes_home / "config.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    section = (cfg.get("dashboard") or {}).get("basic_auth")
    if not isinstance(section, dict):
        raise ValueError(f"{cfg_path} has no dashboard.basic_auth section")
    return DashboardAuth(section)


# ── one gateway connection ────────────────────────────────────────────────────


class Connection:
    """One gateway's WS socket: supervisor loop, RPC dispatch, event fan-out."""

    def __init__(self, name: str, url: str, auth: DashboardAuth, daemon: "RelayDaemon") -> None:
        self.name = name
        self.url = url.rstrip("/")
        self.auth = auth
        self.daemon = daemon
        self.connected = False
        self._ws: Any = None
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id = 0
        self._stop = False

    async def run(self) -> None:
        """Supervisor: keep the socket up with exponential backoff."""
        backoff = RECONNECT_BACKOFF_MIN_S
        while not self._stop:
            try:
                ticket = await asyncio.to_thread(self.auth.mint_ws_ticket, self.url)
                ws_url = (
                    self.url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
                    + f"/api/ws?ticket={ticket}"
                )
                async with websockets.connect(
                    ws_url, ping_interval=30, ping_timeout=30, max_size=None
                ) as ws:
                    self._ws = ws
                    await self._wait_ready(ws)
                    self.connected = True
                    backoff = RECONNECT_BACKOFF_MIN_S
                    log.info("[%s] connected to %s", self.name, self.url)
                    ping_task = asyncio.create_task(self._ping_loop())
                    try:
                        self.daemon.on_connection_up(self.name)
                        async for raw in ws:
                            self._handle_frame(raw)
                    finally:
                        ping_task.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self.connected:
                    log.warning("[%s] connection lost: %s: %s", self.name, type(exc).__name__, exc)
                else:
                    log.warning(
                        "[%s] connect failed (%s: %s) — retry in %.0fs",
                        self.name, type(exc).__name__, exc, backoff,
                    )
            finally:
                self._drop()
            if not self._stop:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, RECONNECT_BACKOFF_MAX_S)

    def stop(self) -> None:
        self._stop = True

    async def _wait_ready(self, ws: Any) -> None:
        """Consume frames until the server-side ``gateway.ready`` event lands."""
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(1.0, deadline - time.monotonic()))
            obj = json.loads(raw)
            if obj.get("method") == "event" and (obj.get("params") or {}).get("type") == "gateway.ready":
                return
            self._handle_frame(raw, already_parsed=obj)
        raise TimeoutError("gateway.ready not received within 15s")

    async def _ping_loop(self) -> None:
        """Keep the gateway-side last_inbound_at fresh (and detect half-open)."""
        while True:
            await asyncio.sleep(GATEWAY_PING_INTERVAL_S)
            try:
                await self.rpc("gateway.ping", {}, timeout=15.0)
            except Exception as exc:
                log.debug("[%s] gateway.ping failed: %s", self.name, exc)

    def _drop(self) -> None:
        was_connected = self.connected
        self.connected = False
        self._ws = None
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(NotConnectedError("socket dropped"))
        self._pending.clear()
        if was_connected:
            self.daemon.on_connection_down(self.name)

    def _handle_frame(self, raw: str, already_parsed: Optional[dict] = None) -> None:
        try:
            obj = already_parsed if already_parsed is not None else json.loads(raw)
        except (ValueError, TypeError):
            log.warning("[%s] unparseable frame dropped", self.name)
            return
        if not isinstance(obj, dict):
            return
        if obj.get("method") == "event":
            params = obj.get("params") or {}
            self.daemon.on_event(self.name, str(params.get("type") or ""), params.get("payload"))
            return
        rid = obj.get("id")
        fut = self._pending.pop(rid, None) if rid is not None else None
        if fut is None or fut.done():
            return
        if "error" in obj and obj["error"] is not None:
            err = obj["error"] or {}
            fut.set_exception(
                RpcError(int(err.get("code") or 0), str(err.get("message") or "rpc error"), err.get("data"))
            )
        else:
            fut.set_result(obj.get("result"))

    async def rpc(self, method: str, params: dict, timeout: float = DEFAULT_RPC_TIMEOUT_S) -> Any:
        ws = self._ws
        if not self.connected or ws is None:
            raise NotConnectedError(f"[{self.name}] not connected")
        self._next_id += 1
        rid = self._next_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        try:
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(rid, None)


# ── roster rows ───────────────────────────────────────────────────────────────


def _bot_handle(profile: dict) -> str:
    """Mirror plugin.js botHandle(): an explicit distinct handle wins, else
    the primary profile answers to 'hermes'."""
    name = str(profile.get("name") or "")
    handle = str(profile.get("handle") or "")
    if handle and handle != name:
        return handle
    return "hermes" if name.strip().lower() == "default" else name


def _roster_row(profile: dict, connection_id: str, connection_label: str) -> Optional[dict]:
    name = str(profile.get("name") or "").strip()
    if not name:
        return None
    ui_meta = profile.get("ui_meta")
    bots_meta = (ui_meta.get("hermes-bots") or {}) if isinstance(ui_meta, dict) else {}
    return {
        "profile": name,
        "handle": _bot_handle(profile),
        "connection_id": connection_id,
        "connection_label": connection_label,
        "title": str(bots_meta.get("title") or profile.get("display_name") or ""),
        "description": str(profile.get("description") or ""),
    }


# ── the daemon ────────────────────────────────────────────────────────────────


class RelayDaemon:
    def __init__(self, connections: list[Connection]) -> None:
        self.connections = {c.name: c for c in connections}
        self._agents_cache: dict[str, list[dict]] = {}
        self._roster_busy = False
        self._drain_busy = False
        self._drain_rerun = False
        self._debounce_handle: Optional[asyncio.TimerHandle] = None
        self._stop_event = asyncio.Event()

    # ── callbacks from Connection ────────────────────────────────────────────

    def on_event(self, conn_name: str, event_type: str, payload: Any) -> None:
        if event_type == "bot_relay.outbox.pending":
            log.debug("[%s] push: bot_relay.outbox.pending — scheduling drain", conn_name)
            self.schedule_drain()

    def on_connection_up(self, name: str) -> None:
        # Envelopes may have queued while the socket was down — drain now.
        self.schedule_drain()
        asyncio.create_task(self.sync_rosters())

    def on_connection_down(self, name: str) -> None:
        log.info("[%s] marked offline", name)

    # ── roster loop ──────────────────────────────────────────────────────────

    def _live(self) -> dict[str, Connection]:
        return {n: c for n, c in self.connections.items() if c.connected}

    async def roster_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=ROSTER_INTERVAL_S)
            except asyncio.TimeoutError:
                pass
            await self.sync_rosters()

    async def sync_rosters(self) -> None:
        if self._roster_busy:
            return
        self._roster_busy = True
        try:
            live = self._live()
            if len(live) < 2:
                return

            agents_by: dict[str, list[dict]] = {}

            async def fetch(name: str, conn: Connection) -> None:
                try:
                    res = await conn.rpc("profiles.list", {"include_sessions": False})
                    profiles = res.get("profiles") if isinstance(res, dict) else None
                    rows = [
                        row
                        for p in (profiles or [])
                        if isinstance(p, dict)
                        for row in [_roster_row(p, name, name)]
                        if row is not None
                    ]
                    self._agents_cache[name] = rows
                    agents_by[name] = rows
                except Exception as exc:
                    # Fail-soft: reuse last-good rows so a transient blip never
                    # drops a live machine's agents from the pushed roster.
                    agents_by[name] = self._agents_cache.get(name, [])
                    log.warning(
                        "[%s] profiles.list failed (%s: %s) — reusing %d cached rows",
                        name, type(exc).__name__, exc, len(agents_by[name]),
                    )

            await asyncio.gather(*(fetch(n, c) for n, c in live.items()))

            # Connections no longer live are genuinely gone — drop their cache.
            for name in list(self._agents_cache):
                if name not in live:
                    del self._agents_cache[name]

            async def push(name: str, conn: Connection) -> None:
                others = [r for n, rows in agents_by.items() if n != name for r in rows]
                try:
                    res = await conn.rpc("bot_relay.roster.sync", {"agents": others})
                    count = res.get("count") if isinstance(res, dict) else "?"
                    log.info("[%s] roster.sync pushed %d rows (accepted %s)", name, len(others), count)
                except Exception as exc:
                    log.debug("[%s] roster.sync skipped: %s", name, exc)

            await asyncio.gather(*(push(n, c) for n, c in live.items()))
        finally:
            self._roster_busy = False

    # ── drain loop ───────────────────────────────────────────────────────────

    def schedule_drain(self) -> None:
        """Debounce: a burst of pending signals collapses to ONE drain."""
        if self._debounce_handle is not None:
            return
        self._debounce_handle = asyncio.get_running_loop().call_later(
            PUSH_DEBOUNCE_S, self._debounce_fired
        )

    def _debounce_fired(self) -> None:
        self._debounce_handle = None
        asyncio.create_task(self.drain_outboxes())

    async def drain_poll_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=DRAIN_POLL_INTERVAL_S)
            except asyncio.TimeoutError:
                pass
            await self.drain_outboxes()

    async def _post_reply(self, sender: Connection, envelope_id: str, **payload: Any) -> None:
        try:
            await sender.rpc("bot_relay.reply", {"id": envelope_id, **payload})
        except Exception as exc:
            # Sender gateway unreachable — its waiter times out with guidance.
            log.warning(
                "[%s] reply for envelope %s failed to post: %s", sender.name, envelope_id, exc
            )

    async def drain_outboxes(self) -> None:
        if self._drain_busy:
            # A push raced an in-flight drain; the gateway never re-broadcasts
            # it, so remember it and re-run after this drain finishes.
            self._drain_rerun = True
            return
        self._drain_busy = True
        try:
            live = self._live()
            if not live:
                return
            for name, sender in live.items():
                try:
                    res = await sender.rpc("bot_relay.outbox.drain", {})
                    envelopes = res.get("envelopes") if isinstance(res, dict) else None
                except Exception as exc:
                    log.debug("[%s] outbox.drain skipped: %s", name, exc)
                    continue
                envelopes = [e for e in (envelopes or []) if isinstance(e, dict)]
                if envelopes:
                    log.info("[%s] drained %d envelope(s)", name, len(envelopes))
                for envelope in envelopes:
                    envelope_id = str(envelope.get("id") or "")
                    if not envelope_id:
                        continue
                    target_name = str(envelope.get("target_connection") or "")
                    target = live.get(target_name)
                    if target is None:
                        log.info(
                            "[%s] envelope %s → connection '%s' offline — error reply",
                            name, envelope_id, target_name,
                        )
                        await self._post_reply(
                            sender,
                            envelope_id,
                            error=(
                                f"connection '{target_name}' is not connected to "
                                "this relay right now"
                            ),
                            reason=REASON_RUNTIME_OFFLINE,
                        )
                        continue
                    log.info(
                        "[%s] envelope %s → deliver to %s/%s",
                        name, envelope_id, target_name, envelope.get("target_profile"),
                    )
                    try:
                        res = await target.rpc(
                            "bot_relay.deliver",
                            {
                                "profile": str(envelope.get("target_profile") or ""),
                                "message": str(envelope.get("message") or ""),
                            },
                            timeout=DELIVER_TIMEOUT_S,
                        )
                        reply = str(res.get("reply") or "") if isinstance(res, dict) else ""
                        await self._post_reply(sender, envelope_id, reply=reply)
                        log.info("[%s] envelope %s delivered, reply posted", name, envelope_id)
                    except RpcError as exc:
                        reason = ""
                        if isinstance(exc.data, dict):
                            reason = str(exc.data.get("reason") or "").strip()
                        await self._post_reply(
                            sender, envelope_id, error=exc.message, **({"reason": reason} if reason else {})
                        )
                        log.warning(
                            "[%s] envelope %s delivery failed (code=%s reason=%s): %s",
                            name, envelope_id, exc.code, reason or "-", exc.message,
                        )
                    except asyncio.TimeoutError:
                        await self._post_reply(
                            sender, envelope_id,
                            error=f"bot_relay.deliver exceeded {DELIVER_TIMEOUT_S:.0f}s",
                            reason=REASON_DELIVERY_TIMEOUT,
                        )
                        log.warning("[%s] envelope %s deliver timed out", name, envelope_id)
                    except Exception as exc:
                        await self._post_reply(sender, envelope_id, error=str(exc))
                        log.warning("[%s] envelope %s delivery error: %s", name, envelope_id, exc)
        finally:
            self._drain_busy = False
            if self._drain_rerun:
                self._drain_rerun = False
                self.schedule_drain()

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def run(self) -> None:
        tasks = [asyncio.create_task(c.run(), name=f"conn-{c.name}") for c in self.connections.values()]
        tasks.append(asyncio.create_task(self.roster_loop(), name="roster-loop"))
        tasks.append(asyncio.create_task(self.drain_poll_loop(), name="drain-poll"))
        await self._stop_event.wait()
        for conn in self.connections.values():
            conn.stop()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def stop(self) -> None:
        self._stop_event.set()


# ── entry point ───────────────────────────────────────────────────────────────


def load_config(path: Path) -> list[dict]:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    conns = cfg.get("connections")
    if not isinstance(conns, list) or not conns:
        raise ValueError(f"{path}: 'connections' must be a non-empty list")
    out = []
    for entry in conns:
        if not isinstance(entry, dict):
            raise ValueError(f"{path}: each connection must be a mapping")
        name = str(entry.get("name") or "").strip()
        url = str(entry.get("url") or "").strip()
        if not name or not url:
            raise ValueError(f"{path}: each connection needs 'name' and 'url'")
        out.append({"name": name, "url": url})
    return out


async def _amain(args: argparse.Namespace) -> int:
    conn_cfgs = load_config(Path(args.config))
    hermes_home = Path(args.hermes_home or (Path.home() / ".hermes"))
    auth = load_dashboard_auth(hermes_home)
    log.info(
        "starting relay daemon: connections=%s auth_user=%s",
        [c["name"] for c in conn_cfgs], auth.username,
    )
    daemon = RelayDaemon([])
    daemon.connections = {
        c.name: c for c in (Connection(c["name"], c["url"], auth, daemon) for c in conn_cfgs)
    }

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, daemon.stop)

    await daemon.run()
    log.info("relay daemon stopped")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Hermes Bot Mode headless relay daemon")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parent / "config.yaml"),
        help="path to the daemon config.yaml (default: beside this script)",
    )
    parser.add_argument("--hermes-home", default=None, help="HERMES_HOME (default: ~/.hermes)")
    parser.add_argument("-v", "--verbose", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    # Library DEBUG frames leak credentials (the ?ticket= query rides the WS
    # handshake log line) — pin them at WARNING even in verbose mode.
    for noisy in ("websockets", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    try:
        return asyncio.run(_amain(args))
    except (ValueError, FileNotFoundError) as exc:
        log.error("startup failed: %s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
