#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from typing import Sequence


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a command with periodic heartbeats and a hard timeout."
    )
    parser.add_argument("--label", required=True, help="Short label for log lines.")
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        required=True,
        help="Maximum runtime before the child process group is terminated.",
    )
    parser.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=60,
        help="Seconds between heartbeat log lines.",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command to execute. Prefix with -- to stop option parsing.",
    )
    args = parser.parse_args(argv)
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("missing command to run")
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    if args.heartbeat_seconds <= 0:
        parser.error("--heartbeat-seconds must be positive")
    return args


def format_elapsed(seconds: float) -> str:
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def print_process_snapshot(pid: int, label: str) -> None:
    try:
        subprocess.run(
            [
                "ps",
                "-axo",
                "pid,ppid,pgid,stat,etime,%cpu,%mem,command",
            ],
            check=False,
            text=True,
            env=os.environ,
        )
    except Exception as exc:
        print(f"[{label}] failed to capture process snapshot: {exc}", flush=True)
    else:
        print(f"[{label}] captured process snapshot for pid {pid}", flush=True)


def terminate_process_group(process: subprocess.Popen[bytes], label: str) -> int:
    try:
        pgid = os.getpgid(process.pid)
    except ProcessLookupError:
        return process.wait()

    print(f"[{label}] sending SIGTERM to process group {pgid}", flush=True)
    os.killpg(pgid, signal.SIGTERM)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            return exit_code
        time.sleep(1)

    print(f"[{label}] sending SIGKILL to process group {pgid}", flush=True)
    os.killpg(pgid, signal.SIGKILL)
    return process.wait()


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    label = args.label

    print(f"[{label}] starting command: {' '.join(args.command)}", flush=True)
    process = subprocess.Popen(args.command, preexec_fn=os.setsid)
    start = time.monotonic()
    next_heartbeat = start + args.heartbeat_seconds

    def forward_signal(signum: int, _frame: object) -> None:
        print(f"[{label}] forwarding signal {signum} to child process group", flush=True)
        try:
            os.killpg(os.getpgid(process.pid), signum)
        except ProcessLookupError:
            return

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, forward_signal)

    while True:
        exit_code = process.poll()
        now = time.monotonic()
        if exit_code is not None:
            elapsed = format_elapsed(now - start)
            print(
                f"[{label}] command exited with code {exit_code} after {elapsed}",
                flush=True,
            )
            return exit_code

        if now >= next_heartbeat:
            elapsed = format_elapsed(now - start)
            print(f"[{label}] heartbeat elapsed={elapsed} pid={process.pid}", flush=True)
            next_heartbeat += args.heartbeat_seconds

        if now - start >= args.timeout_seconds:
            elapsed = format_elapsed(now - start)
            print(
                f"[{label}] timeout after {elapsed}; terminating child process group",
                flush=True,
            )
            print_process_snapshot(process.pid, label)
            terminate_process_group(process, label)
            return 124

        time.sleep(1)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
