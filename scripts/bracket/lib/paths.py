from pathlib import Path

# Package root: scripts/bracket/lib → scripts/bracket → project root
LIB_DIR = Path(__file__).resolve().parent
BRACKET_DIR = LIB_DIR.parent
BASE_DIR = BRACKET_DIR.parent.parent  # TennisBotMax root
FONTS_DIR = BRACKET_DIR / "fonts"
DATA_DIR = BASE_DIR / "data"
GAMES_PHOTOS_DIR = DATA_DIR / "games_photos"

FONTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
GAMES_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
