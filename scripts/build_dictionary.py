#!/usr/bin/env python3
"""Build the local bilingual dictionary shards.

Sources:
  - CC-CEDICT (Chinese -> English), CC BY-SA 4.0
  - FreeDict eng-zho (English -> Chinese), CC BY-SA 3.0

Output:
  public/dict/zh/uXX.json   Chinese entries, sharded by first code point % 256
  public/dict/en/xx.json    English entries, sharded by first two alphanumeric chars
  public/dict/manifest.json
  public/dict/NOTICE.txt

Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import shutil
import struct
import tarfile
import unicodedata
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "dictionary"
OUTPUT = ROOT / "public" / "dict"

CC_CEDICT_URL = (
    "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
)
FREEDICT_URL = (
    "https://download.freedict.org/dictionaries/eng-zho/2025.11.23/"
    "freedict-eng-zho-2025.11.23.stardict.tar.xz"
)

CEDICT_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+/(.*)/$")
CJK_RUN_RE = re.compile(r"[\u3400-\u9fff][\u3400-\u9fff·]{0,15}")
HTML_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")

POS_ABBR = {
    "noun": "n.",
    "verb": "v.",
    "adjective": "adj.",
    "adverb": "adv.",
    "interjection": "interj.",
    "preposition": "prep.",
    "conjunction": "conj.",
    "pronoun": "pron.",
    "determiner": "det.",
    "numeral": "num.",
    "particle": "part.",
    "auxiliary verb": "aux.",
    "proper noun": "prop. n.",
}


def clean_text(value: str) -> str:
    return WHITESPACE_RE.sub(" ", value or "").strip()


def normalize_english(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower().replace("’", "'")
    value = re.sub(r"[^a-z0-9' -]+", " ", value)
    return WHITESPACE_RE.sub(" ", value).strip(" -")


def zh_shard_key(term: str) -> str:
    return f"u{ord(term[0]) % 256:02x}"


def en_shard_key(term: str) -> str:
    safe = re.sub(r"[^a-z0-9]", "", term)
    return (safe + "__")[:2]


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "spoken-english-dict/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as out:
        length = response.headers.get("Content-Length")
        total = int(length) if length and length.isdigit() else 0
        done = 0
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"  {done / total * 100:5.1f}%", end="\r")
    print(f"\nSaved {destination}")


def ensure_cc_cedict(path: Path) -> Path:
    if path.exists():
        return path
    download(CC_CEDICT_URL, path)
    return path


def ensure_freedict(path: Path) -> Path:
    """Return a directory containing eng-zho.idx.gz and eng-zho.dict."""
    if path.is_dir():
        if (path / "eng-zho.idx.gz").exists() and (path / "eng-zho.dict").exists():
            return path
        raise FileNotFoundError(f"{path} does not contain eng-zho.idx.gz / eng-zho.dict")
    if path.exists() and path.suffix == ".xz":
        target = path.with_suffix("").with_suffix("")
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(path, "r:xz") as archive:
            archive.extractall(target)
        for directory in target.iterdir():
            if (directory / "eng-zho.idx.gz").exists():
                return directory
        raise FileNotFoundError("eng-zho.idx.gz not found in archive")
    if not path.exists():
        archive = CACHE / "freedict-eng-zho.tar.xz"
        download(FREEDICT_URL, archive)
        return ensure_freedict(archive)
    raise FileNotFoundError(f"Unsupported FreeDict path: {path}")


def parse_cc_cedict(path: Path) -> tuple[dict[str, list[dict]], dict]:
    chinese: dict[str, list[dict]] = defaultdict(list)
    metadata: dict[str, str | int] = {}

    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:  # type: ignore[arg-type]
        for raw in handle:
            line = raw.strip()
            if line.startswith("#! ") and "=" in line:
                key, value = line[3:].split("=", 1)
                metadata[key] = int(value) if key in {"entries", "version", "subversion"} else value
                continue
            if not line or line.startswith("#"):
                continue
            match = CEDICT_RE.match(line)
            if not match:
                continue
            traditional, simplified, _pinyin, raw_defs = match.groups()
            definitions = [
                clean_text(item)
                for item in raw_defs.split("/")
                if clean_text(item)
            ]
            if not definitions:
                continue
            entry: dict[str, str | list[str]] = {
                "s": simplified,
                "d": definitions[:8],
            }
            if traditional != simplified:
                entry["t"] = traditional

            chinese[simplified].append(entry)
            if traditional != simplified:
                chinese[traditional].append(entry)

    # Deduplicate entries that differ only by source key.
    for key, entries in list(chinese.items()):
        seen: set[str] = set()
        unique: list[dict] = []
        for entry in entries:
            signature = json.dumps(entry, ensure_ascii=False, sort_keys=True)
            if signature not in seen:
                seen.add(signature)
                unique.append(entry)
        chinese[key] = unique

    return chinese, metadata


def parse_freedict(directory: Path) -> tuple[dict[str, list[dict]], dict]:
    index_data = gzip.open(directory / "eng-zho.idx.gz", "rb").read()
    dictionary_data = (directory / "eng-zho.dict").read_bytes()

    entries: dict[str, list[dict]] = defaultdict(list)
    seen: dict[str, set[str]] = defaultdict(set)
    position = 0
    headwords = 0

    while position < len(index_data):
        separator = index_data.index(b"\0", position)
        headword = index_data[position:separator].decode("utf-8", "ignore")
        offset, size = struct.unpack(">II", index_data[separator + 1 : separator + 9])
        position = separator + 9

        key = normalize_english(headword)
        if not key:
            continue

        raw = dictionary_data[offset : offset + size].decode("utf-8", "ignore")
        pronunciations = [
            clean_text(html.unescape(HTML_TAG_RE.sub("", value))).split("/")[0].strip()
            for value in re.findall(r'<font color="gray">(.*?)</font>', raw, flags=re.S)
        ]
        pronunciations = [
            value.strip().strip("[]").strip()
            for value in pronunciations
            if value
        ]
        pronunciations = [
            value
            for value in pronunciations
            if value
            and not value.startswith("-")
            and not CJK_RUN_RE.search(value)
            and "<" not in value
            and ">" not in value
            and len(value) <= 80
        ]
        parts = [
            clean_text(html.unescape(value))
            for value in re.findall(
                r'<font class="grammar"[^>]*>(.*?)</font>', raw, flags=re.S
            )
        ]

        plain = html.unescape(HTML_TAG_RE.sub(" ", raw))
        translations = []
        for match in CJK_RUN_RE.finditer(plain):
            value = match.group(0).strip("· ")
            if value and value not in translations:
                translations.append(value)

        if not translations:
            continue

        entry: dict[str, object] = {
            "w": headword,
            "z": translations[:8],
        }
        if pronunciations:
            entry["r"] = list(dict.fromkeys(pronunciations))[:3]
        translated_parts = []
        for part in parts:
            part = part.lower()
            abbreviation = POS_ABBR.get(part)
            if abbreviation and abbreviation not in translated_parts:
                translated_parts.append(abbreviation)
        if translated_parts:
            entry["p"] = " / ".join(translated_parts)

        signature = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        if signature in seen[key]:
            continue
        seen[key].add(signature)
        entries[key].append(entry)
        headwords += 1

    merged: dict[str, list[dict]] = {}
    for key, items in entries.items():
        translations: list[str] = []
        pronunciations: list[str] = []
        parts: list[str] = []
        for item in items:
            for value in item.get("z", []):
                if value not in translations:
                    translations.append(value)
            for value in item.get("r", []):
                if value not in pronunciations:
                    pronunciations.append(value)
            part = item.get("p")
            if isinstance(part, str) and part not in parts:
                parts.append(part)
        entry: dict[str, object] = {
            "w": items[0]["w"],
            "z": translations[:8],
        }
        if pronunciations:
            entry["r"] = pronunciations[:3]
        if parts:
            entry["p"] = " / ".join(parts)
        merged[key] = [entry]

    return merged, {"headwords": headwords, "sourceHeadwords": 26660}


def write_shards(
    index: dict[str, list[dict]],
    directory: Path,
    shard_function,
) -> tuple[int, int, int]:
    shards: dict[str, dict[str, list[dict]]] = defaultdict(dict)
    for term, entries in index.items():
        shards[shard_function(term)][term] = entries

    directory.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for shard, payload in shards.items():
        ordered = dict(sorted(payload.items(), key=lambda item: item[0]))
        text = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
        encoded = text.encode("utf-8")
        total_bytes += len(encoded)
        (directory / f"{shard}.json").write_bytes(encoded)

    return len(index), len(shards), total_bytes


def write_notice(path: Path, cc_meta: dict, free_meta: dict) -> None:
    text = f"""Dictionary data sources
=======================

CC-CEDICT (Chinese -> English)
- Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- License: Creative Commons Attribution-ShareAlike 4.0 International
- License URL: https://creativecommons.org/licenses/by-sa/4.0/
- Entries: {cc_meta.get('entries', 'unknown')}
- Copyright: MDBG and CC-CEDICT contributors

FreeDict eng-zho (English -> Chinese)
- Source: https://freedict.org/dictionaries/eng-zho/2025.11.23/
- License: Creative Commons Attribution-ShareAlike 3.0 Unported
- License URL: https://creativecommons.org/licenses/by-sa/3.0/
- Headwords: {free_meta.get('sourceHeadwords', 26660)}
- Data from Wiktionary via DBnary, transformed by WikDict/FreeDict.
- Copyright: FreeDict, WikDict and Wiktionary contributors

This app distributes transformed versions of the dictionaries above.
If you redistribute the generated data, keep this attribution and the
same CC BY-SA license for the derived dictionary data.
"""
    path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cc-cedict", type=Path, default=CACHE / "cedict.txt.gz")
    parser.add_argument("--freedict", type=Path, default=CACHE / "freedict-eng-zho")
    parser.add_argument("--out", type=Path, default=OUTPUT)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()

    cc_path = args.cc_cedict
    free_path = args.freedict

    if not cc_path.exists():
        if args.no_download:
            raise SystemExit(f"Missing CC-CEDICT file: {cc_path}")
        cc_path = ensure_cc_cedict(cc_path)

    if not free_path.exists():
        if args.no_download:
            raise SystemExit(f"Missing FreeDict path: {free_path}")
        free_path = ensure_freedict(free_path)
    else:
        free_path = ensure_freedict(free_path)

    print("Parsing CC-CEDICT...")
    chinese, cc_meta = parse_cc_cedict(cc_path)
    print(f"  Chinese keys: {len(chinese):,}")

    print("Parsing FreeDict eng-zho...")
    english, free_meta = parse_freedict(free_path)
    print(f"  English keys: {len(english):,}")

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)

    zh_terms, zh_shards, zh_bytes = write_shards(
        chinese, args.out / "zh", zh_shard_key
    )
    en_terms, en_shards, en_bytes = write_shards(
        english, args.out / "en", en_shard_key
    )

    built_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "version": built_at[:10],
        "builtAt": built_at,
        "counts": {
            "zhTerms": zh_terms,
            "enTerms": en_terms,
            "zhShards": zh_shards,
            "enShards": en_shards,
            "zhBytes": zh_bytes,
            "enBytes": en_bytes,
        },
        "sources": {
            "ccCedict": {
                "name": "CC-CEDICT",
                "url": "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "entries": cc_meta.get("entries", zh_terms),
            },
            "freeDict": {
                "name": "FreeDict eng-zho",
                "url": "https://freedict.org/dictionaries/eng-zho/2025.11.23/",
                "license": "CC BY-SA 3.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
                "entries": free_meta.get("sourceHeadwords", en_terms),
            },
        },
    }
    (args.out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_notice(args.out / "NOTICE.txt", cc_meta, free_meta)

    print()
    print(f"Wrote {zh_shards} Chinese shards, {zh_bytes / 1024 / 1024:.2f} MB raw")
    print(f"Wrote {en_shards} English shards, {en_bytes / 1024 / 1024:.2f} MB raw")
    print(f"Output: {args.out}")


if __name__ == "__main__":
    main()
