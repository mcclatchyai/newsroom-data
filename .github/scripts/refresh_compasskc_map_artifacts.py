#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from urllib.request import urlopen


DEFAULT_INDEX_URL = "https://compasskcalerts-b2qqqk4i3a-uc.a.run.app/maps/compasskc/artifacts/index.json"
PAGES_BASE_URL = "https://mcclatchyai.github.io/newsroom-data"
PROJECT_SLUG = "compasskc-map-artifacts"
CACHE_TTL_SECONDS = 900
MAX_PUBLIC_FILE_BYTES = 5 * 1024 * 1024

FORBIDDEN_PUBLIC_PATTERNS = [
    re.compile(r"/Users/[A-Za-z0-9_.-]+"),
    re.compile(r"(^|[\"'/])\\.env([\"'/]|$)"),
    re.compile(r"Bearer\\s+[A-Za-z0-9._~+/=-]+", re.I),
    re.compile(r"X-CompassKC-Token", re.I),
    re.compile(r"PROCESS_ITEMS_API_TOKEN", re.I),
    re.compile(r"SEEN_SPREADSHEET_ID", re.I),
    re.compile(r"sheets-microservice", re.I),
    re.compile(r"gmail-microservice", re.I),
    re.compile(r"secretmanager", re.I),
    re.compile(r"owner_(?:name|address|mail|tax)", re.I),
    re.compile(r"taxpayer", re.I),
    re.compile(r"raw scrape", re.I),
    re.compile(r"private notes?", re.I),
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _data_version(generated_at: str) -> str:
    compact = re.sub(r"[^0-9]", "", generated_at or "")
    return compact[:14] + "Z" if len(compact) >= 14 else _utc_now().replace("-", "").replace(":", "")


def _stale_after(generated_at: str) -> str:
    parsed = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    return (parsed.astimezone(timezone.utc) + timedelta(seconds=CACHE_TTL_SECONDS)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_artifact_id(value: Any) -> str:
    artifact_id = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,80}", artifact_id):
        raise RuntimeError(f"Unsafe artifact_id in public artifact index: {artifact_id!r}")
    return artifact_id


def _fetch_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=90) as response:  # noqa: S310 - controlled workflow input.
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object from {url}")
    return payload


def _fetch_text(url: str) -> str:
    with urlopen(url, timeout=90) as response:  # noqa: S310 - controlled workflow input.
        return response.read().decode("utf-8")


def _artifact_rel_dir(artifact_id: str) -> Path:
    return Path("artifacts") / artifact_id[:2].lower() / artifact_id


def _artifact_public_urls(*, environment: str, artifact_id: str) -> dict[str, str]:
    base = f"{PAGES_BASE_URL}/maps/{PROJECT_SLUG}/v1/{environment}/{_artifact_rel_dir(artifact_id).as_posix()}"
    return {
        "data_url": f"{base}/data.geojson",
        "embed_url": f"{base}/embed.html",
    }


def _static_embed_html(*, html: str, artifact_id: str, source_geojson_url: str, static_geojson_url: str) -> str:
    transformed = html.replace(source_geojson_url, static_geojson_url)
    transformed = re.sub(
        rf"https?://[^\"'<>\s]+/maps/compasskc/{re.escape(artifact_id)}\\.geojson",
        static_geojson_url,
        transformed,
    )
    if static_geojson_url not in transformed:
        raise RuntimeError(f"Static GeoJSON URL was not found in transformed embed for {artifact_id}.")
    return transformed


def _json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _text_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")


def _load_artifacts(index_url: str, *, limit: int) -> list[dict[str, Any]]:
    index = _fetch_json(index_url)
    artifacts = index.get("artifacts") if isinstance(index.get("artifacts"), list) else []
    loaded: list[dict[str, Any]] = []
    for item in artifacts[: max(0, limit)]:
        if not isinstance(item, dict):
            continue
        artifact_id = _safe_artifact_id(item.get("artifact_id"))
        geojson_url = str(item.get("geojson_url") or "").strip()
        embed_url = str(item.get("embed_url") or "").strip()
        if not geojson_url or not embed_url:
            continue
        geojson = _fetch_json(geojson_url)
        if geojson.get("type") != "FeatureCollection":
            raise RuntimeError(f"Expected GeoJSON FeatureCollection for artifact {artifact_id}.")
        embed_html = _fetch_text(embed_url)
        loaded.append(
            {
                "artifact_id": artifact_id,
                "record_key": str(item.get("record_key") or "").strip(),
                "permit_number": str(item.get("permit_number") or "").strip(),
                "created_at_utc": str(item.get("created_at_utc") or "").strip(),
                "source_preview_url": str(item.get("preview_url") or "").strip(),
                "source_geojson_url": geojson_url,
                "source_embed_url": embed_url,
                "geojson": geojson,
                "embed_html": embed_html,
            }
        )
    return loaded


def _manifest(*, environment: str, artifacts: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    public_artifacts = []
    for artifact in artifacts:
        artifact_id = artifact["artifact_id"]
        public_artifacts.append(
            {
                "artifact_id": artifact_id,
                "record_key": artifact.get("record_key", ""),
                "permit_number": artifact.get("permit_number", ""),
                "created_at_utc": artifact.get("created_at_utc", ""),
                **_artifact_public_urls(environment=environment, artifact_id=artifact_id),
            }
        )
    base = f"{PAGES_BASE_URL}/maps/{PROJECT_SLUG}/v1/{environment}"
    return {
        "schema_version": 1,
        "project": PROJECT_SLUG,
        "environment": environment,
        "generated_at": generated_at,
        "data_version": _data_version(generated_at),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "stale_after": _stale_after(generated_at),
        "source": "CompassKC single-permit map artifacts exported from sanitized Cloud Run map endpoints",
        "artifact_count": len(public_artifacts),
        "entrypoints": {
            "artifacts_index": f"{base}/manifest.json",
        },
        "artifacts": public_artifacts,
        "privacy": {
            "public_fields_only": True,
            "scope": "single-permit map GeoJSON and embed HTML; no owner, taxpayer, raw scrape, or internal payload fields",
        },
    }


def _write_bundle(*, output_dir: Path, environment: str, artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    shutil.rmtree(output_dir, ignore_errors=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_at = _utc_now()
    for artifact in artifacts:
        artifact_id = artifact["artifact_id"]
        urls = _artifact_public_urls(environment=environment, artifact_id=artifact_id)
        rel_dir = _artifact_rel_dir(artifact_id)
        _json_write(output_dir / rel_dir / "data.geojson", artifact["geojson"])
        _text_write(
            output_dir / rel_dir / "embed.html",
            _static_embed_html(
                html=artifact["embed_html"],
                artifact_id=artifact_id,
                source_geojson_url=artifact["source_geojson_url"],
                static_geojson_url=urls["data_url"],
            ),
        )
    manifest = _manifest(environment=environment, artifacts=artifacts, generated_at=generated_at)
    _json_write(output_dir / "manifest.json", manifest)
    return manifest


def _scan_text(path: Path, text: str, failures: list[str]) -> None:
    for pattern in FORBIDDEN_PUBLIC_PATTERNS:
        if pattern.search(text):
            failures.append(f"{path}: matched forbidden public-data pattern {pattern.pattern!r}")


def _audit_file(path: Path, failures: list[str]) -> None:
    if path.stat().st_size > MAX_PUBLIC_FILE_BYTES:
        failures.append(f"{path}: exceeds {MAX_PUBLIC_FILE_BYTES} bytes")
    text = path.read_text(encoding="utf-8")
    if path.name == "manifest.json":
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            failures.append(f"{path}: invalid JSON: {exc}")
            return
        scan_payload = {key: value for key, value in payload.items() if key != "privacy"}
        _scan_text(path, json.dumps(scan_payload, sort_keys=True), failures)
        for key in ("schema_version", "project", "environment", "generated_at", "data_version", "entrypoints", "artifacts"):
            if key not in payload:
                failures.append(f"{path}: missing manifest key {key!r}")
        return
    _scan_text(path, text, failures)
    if path.suffix == ".geojson":
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            failures.append(f"{path}: invalid JSON: {exc}")
            return
        if payload.get("type") != "FeatureCollection":
            failures.append(f"{path}: expected GeoJSON FeatureCollection")
        for feature in payload.get("features") or []:
            props = feature.get("properties") if isinstance(feature, dict) and isinstance(feature.get("properties"), dict) else {}
            disallowed = [key for key in props if re.search(r"(owner|taxpayer|raw|private)", key, re.I)]
            if disallowed:
                failures.append(f"{path}: feature exposes disallowed property key(s): {', '.join(disallowed)}")


def _audit_tree(root: Path, *, min_artifacts: int) -> dict[str, Any]:
    failures: list[str] = []
    files = sorted(path for path in root.rglob("*") if path.is_file())
    for path in files:
        _audit_file(path, failures)
    manifest_path = root / "prod" / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if int(manifest.get("artifact_count") or 0) < min_artifacts:
            failures.append(f"{manifest_path}: artifact_count is below minimum {min_artifacts}")
    return {
        "ok": not failures,
        "failures": failures,
        "files_checked": len(files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "largest_files": sorted(
            [{"path": str(path), "bytes": path.stat().st_size} for path in files],
            key=lambda item: item["bytes"],
            reverse=True,
        )[:10],
    }


def refresh_artifact_public_data(
    *,
    repo_root: Path,
    index_url: str,
    limit: int,
    promote_prod: bool,
    min_artifacts: int,
) -> dict[str, Any]:
    artifacts = _load_artifacts(index_url, limit=limit)
    project_root = repo_root / "maps" / PROJECT_SLUG / "v1"
    testing_manifest = _write_bundle(
        output_dir=project_root / "testing",
        environment="testing",
        artifacts=artifacts,
    )
    prod_manifest = None
    if promote_prod:
        prod_manifest = _write_bundle(
            output_dir=project_root / "prod",
            environment="prod",
            artifacts=artifacts,
        )
    audit = _audit_tree(project_root if promote_prod else project_root / "testing", min_artifacts=min_artifacts)
    if not audit["ok"]:
        raise RuntimeError("Public artifact audit failed:\n" + "\n".join(audit["failures"]))
    return {
        "testing": {"artifact_count": testing_manifest.get("artifact_count")},
        "prod": {"artifact_count": prod_manifest.get("artifact_count")} if prod_manifest else None,
        "audit": audit,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh static CompassKC single-permit map artifacts.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--index-url", default=DEFAULT_INDEX_URL)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--no-prod", action="store_true")
    parser.add_argument("--min-artifacts", type=int, default=0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    summary = refresh_artifact_public_data(
        repo_root=Path(args.repo_root).resolve(),
        index_url=args.index_url,
        limit=max(1, args.limit),
        promote_prod=not args.no_prod,
        min_artifacts=max(0, args.min_artifacts),
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
