#!/usr/bin/env python3
"""CLI wrapper around TennisBot utils/bracket image generator."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional

# Windows consoles often use cp1251/cp866 — emoji in tournament names must not crash generation
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from lib.models import Player  # noqa: E402
from lib.builders import (  # noqa: E402
    build_tournament_bracket_image_bytes,
    create_simple_text_image_bytes,
)
from lib.round_robin_image_generator import build_round_robin_table  # noqa: E402


def _pow2(n: int) -> int:
    n = max(2, int(n or 2))
    return 1 << math.ceil(math.log2(n))


def rounds_to_matches(rounds: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for r_idx, rnd in enumerate(rounds or []):
        for m_idx, m in enumerate(rnd or []):
            matches.append(
                {
                    "round": r_idx,
                    "match_number": m_idx,
                    "player1_id": m.get("player1_id"),
                    "player2_id": m.get("player2_id"),
                    "winner_id": m.get("winner_id"),
                    "score": m.get("score"),
                    "is_bye": bool(m.get("is_bye")),
                }
            )
    return matches


def build_players(data: Dict[str, Any]) -> List[Player]:
    players: List[Player] = []
    for p in data.get("players") or []:
        pid = str(p.get("id"))
        name = str(p.get("name") or pid)
        photo = p.get("photo_url") or p.get("photo_path")
        players.append(Player(id=pid, name=name, photo_url=photo, initial=p.get("initial")))
    return players


def pad_olympic_players(players: List[Player], target: int) -> List[Player]:
    size = _pow2(target)
    out = list(players)
    while len(out) < size:
        out.append(Player(id=f"empty_{len(out)}", name=" ", photo_url=None, initial=None))
    return out


def generate_png_bytes(data: Dict[str, Any]) -> bytes:
    name = data.get("name") or "Турнир"
    t_type = data.get("type") or "Олимпийская система"
    players = build_players(data)
    completed_games = data.get("completed_games") or []

    if data.get("hide_bracket"):
        body = (
            "Турнирная сетка скрыта администратором.\n\n"
            f"{name}\n"
            f"Участников: {len(players)}"
        )
        return create_simple_text_image_bytes(body, name)

    if t_type == "Круговая":
        table_players = [
            {"id": p.id, "name": p.name, "photo_path": getattr(p, "photo_url", None)}
            for p in players
        ]
        return build_round_robin_table(table_players, completed_games, name)

    # Olympic — same path as TennisBot build_tournament_bracket_image_bytes
    target = int(data.get("participants_count") or data.get("slots") or max(len(players), 2))
    players = pad_olympic_players(players, target)

    participants: Dict[str, Any] = {}
    for p in players:
        if str(p.id).startswith("empty_"):
            continue
        participants[str(p.id)] = {
            "name": p.name,
            "photo_url": getattr(p, "photo_url", None),
        }

    tournament_data = {
        "name": name,
        "type": "Олимпийская система",
        "participants": participants,
        "matches": rounds_to_matches(data.get("rounds") or []),
        "hide_bracket": False,
    }

    image_bytes, _text = build_tournament_bracket_image_bytes(
        tournament_data,
        players,
        completed_games,
    )
    return image_bytes


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate TennisBot-style tournament bracket PNG")
    parser.add_argument("--input", "-i", help="JSON input path (default: stdin)")
    parser.add_argument("--output", "-o", required=True, help="PNG output path")
    args = parser.parse_args()

    raw = open(args.input, "r", encoding="utf-8-sig").read() if args.input else sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        return 1

    try:
        png = generate_png_bytes(data)
    except Exception as e:
        print(f"Bracket generation failed: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(png)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
