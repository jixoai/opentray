#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve hosts via DNS-over-HTTPS and write them into a hosts file."
    )
    parser.add_argument(
        "--hosts-file",
        default="/etc/hosts",
        help="Hosts file to update. Defaults to /etc/hosts.",
    )
    parser.add_argument(
        "--resolver-url",
        default="https://dns.google/resolve",
        help="DNS-over-HTTPS JSON endpoint.",
    )
    parser.add_argument("hosts", nargs="+", help="Hostnames to resolve.")
    return parser.parse_args()


def resolve_a_records(resolver_url: str, host: str) -> list[str]:
    query = urlencode({"name": host, "type": "A"})
    with urlopen(f"{resolver_url}?{query}", timeout=30) as response:
        payload = json.load(response)
    answers = payload.get("Answer", [])
    records = [
        answer["data"]
        for answer in answers
        if answer.get("type") == 1 and answer.get("name", "").rstrip(".") == host
    ]
    unique_records = list(dict.fromkeys(records))
    if not unique_records:
        raise RuntimeError(f"no A records resolved for {host}")
    return unique_records


def should_drop_existing_line(line: str, managed_hosts: set[str]) -> bool:
    if "# opentray-doh" not in line:
        return False
    fields = line.split()
    return any(host in fields[1:] for host in managed_hosts)


def normalize_lines(text: str) -> list[str]:
    if not text:
        return []
    return [line if line.endswith("\n") else f"{line}\n" for line in text.splitlines(True)]


def render_managed_lines(mapping: dict[str, list[str]]) -> Iterable[str]:
    for host, addresses in mapping.items():
        for address in addresses:
            yield f"{address}\t{host}\t# opentray-doh\n"


def update_hosts_file(hosts_path: Path, mapping: dict[str, list[str]]) -> None:
    existing_text = hosts_path.read_text() if hosts_path.exists() else ""
    lines = normalize_lines(existing_text)
    managed_hosts = set(mapping)
    preserved = [
        line for line in lines if not should_drop_existing_line(line, managed_hosts)
    ]
    preserved.extend(render_managed_lines(mapping))
    hosts_path.write_text("".join(preserved))


def main() -> int:
    args = parse_args()
    mapping = {
        host: resolve_a_records(args.resolver_url, host) for host in dict.fromkeys(args.hosts)
    }
    hosts_path = Path(args.hosts_file)
    update_hosts_file(hosts_path, mapping)
    for host, addresses in mapping.items():
        print(f"{host}: {', '.join(addresses)}")
    print(f"updated hosts file: {hosts_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
