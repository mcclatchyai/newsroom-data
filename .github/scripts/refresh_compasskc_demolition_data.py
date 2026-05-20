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
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import urlopen


DEFAULT_SOURCE_URL = "https://compasskcalerts-b2qqqk4i3a-uc.a.run.app/maps/compasskc/evergreen.geojson"
PAGES_BASE_URL = "https://mcclatchyai.github.io/newsroom-data"
RAW_BASE_URL = "https://raw.githubusercontent.com/mcclatchyai/newsroom-data/main"
DATASET_SLUG = "compasskc-demolitions"
TITLE = "Kansas City demolition permits"
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


def _norm(value: Any) -> str:
    return (value or "").strip() if isinstance(value, str) else (str(value) if value is not None else "")


def _with_year_param(source_url: str, year: str | None) -> str:
    parsed = urlparse(source_url)
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "year"]
    if year:
        query.append(("year", year))
    return urlunparse(parsed._replace(query=urlencode(query)))


def _fetch_geojson(source_url: str, *, year: str | None = None) -> dict[str, Any]:
    url = _with_year_param(source_url, year)
    with urlopen(url, timeout=90) as response:  # noqa: S310 - controlled workflow input.
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise RuntimeError(f"Expected GeoJSON FeatureCollection from {url}")
    return payload


def _feature_sort_key(feature: dict[str, Any]) -> tuple[str, str, str]:
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    return (
        _norm(props.get("year")),
        _norm(props.get("activity_date") or props.get("date")),
        _norm(props.get("case_number") or props.get("record_id")),
    )


def _sorted_geojson(geojson: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(geojson)
    features = normalized.get("features") if isinstance(normalized.get("features"), list) else []
    normalized["features"] = sorted(
        [feature for feature in features if isinstance(feature, dict)],
        key=_feature_sort_key,
    )
    metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
    normalized["metadata"] = dict(metadata)
    return normalized


def _without_building_footprints(geojson: dict[str, Any]) -> dict[str, Any]:
    stripped = dict(geojson)
    stripped_features: list[dict[str, Any]] = []
    for feature in geojson.get("features") or []:
        if not isinstance(feature, dict):
            continue
        clean_feature = dict(feature)
        props = clean_feature.get("properties") if isinstance(clean_feature.get("properties"), dict) else {}
        clean_props = dict(props)
        clean_props.pop("building_footprints", None)
        clean_feature["properties"] = clean_props
        stripped_features.append(clean_feature)
    metadata = stripped.get("metadata") if isinstance(stripped.get("metadata"), dict) else {}
    stripped["metadata"] = {
        **metadata,
        "building_footprints_returned": 0,
        "building_footprints_omitted_from_latest": True,
    }
    stripped["features"] = stripped_features
    return stripped


def _available_years(geojson: dict[str, Any]) -> list[str]:
    metadata = geojson.get("metadata") if isinstance(geojson.get("metadata"), dict) else {}
    years = metadata.get("available_years")
    if isinstance(years, list):
        return sorted({_norm(year) for year in years if _norm(year)})
    derived = {
        _norm((feature.get("properties") or {}).get("year"))
        for feature in geojson.get("features", [])
        if isinstance(feature, dict) and isinstance(feature.get("properties"), dict)
    }
    return sorted(year for year in derived if year)


def _data_version(generated_at: str) -> str:
    compact = re.sub(r"[^0-9]", "", generated_at or "")
    return compact[:14] + "Z" if len(compact) >= 14 else _utc_now().replace("-", "").replace(":", "")


def _stale_after(generated_at: str, cache_ttl_seconds: int) -> str:
    try:
        parsed = datetime.fromisoformat((generated_at or "").replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (parsed.astimezone(timezone.utc) + timedelta(seconds=cache_ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _building_footprint_count(features: list[dict[str, Any]]) -> int:
    total = 0
    for feature in features:
        props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        payload = props.get("building_footprints")
        if isinstance(payload, dict) and isinstance(payload.get("features"), list):
            total += len([item for item in payload["features"] if isinstance(item, dict)])
    return total


def _manifest(
    *,
    environment: str,
    latest_geojson: dict[str, Any],
    year_files: dict[str, str],
    public_base_url: str,
    building_footprints_total: int,
) -> dict[str, Any]:
    metadata = latest_geojson.get("metadata") if isinstance(latest_geojson.get("metadata"), dict) else {}
    generated_at = _norm(metadata.get("generated_at")) or _utc_now()
    base = public_base_url.rstrip("/")
    latest_features = latest_geojson.get("features") if isinstance(latest_geojson.get("features"), list) else []
    return {
        "schema_version": 2,
        "project": DATASET_SLUG,
        "environment": environment,
        "dataset": DATASET_SLUG,
        "title": TITLE,
        "description": "Sanitized public GeoJSON for Kansas City CompassKC demolition permit map embeds.",
        "generated_at": generated_at,
        "data_version": _data_version(generated_at),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "stale_after": _stale_after(generated_at, CACHE_TTL_SECONDS),
        "source": _norm(metadata.get("source")) or "CompassKC + KCMO parcels",
        "format": "GeoJSON FeatureCollection",
        "entrypoints": {
            "latest": f"{base}/latest.geojson",
            "by_year": {year: f"{base}/{path}" for year, path in year_files.items()},
        },
        "files": {
            "latest": "latest.geojson",
            "latest_url": f"{base}/latest.geojson",
            "by_year": year_files,
            "by_year_urls": {year: f"{base}/{path}" for year, path in year_files.items()},
        },
        "available_years": sorted(year_files),
        "records_total": metadata.get("records_total", ""),
        "features_total": len(latest_features),
        "unmapped_records": metadata.get("unmapped_records", 0),
        "unmapped_records_by_reason": metadata.get("unmapped_records_by_reason", {}),
        "unmapped_records_note": metadata.get("unmapped_records_note", ""),
        "building_footprints_total": building_footprints_total,
        "building_footprints_source": metadata.get("building_footprints_source", ""),
        "building_footprints_license": metadata.get("building_footprints_license", ""),
        "building_footprints_license_url": metadata.get("building_footprints_license_url", ""),
        "building_footprints_attribution": metadata.get("building_footprints_attribution", ""),
        "building_footprints_note": metadata.get("building_footprints_note", ""),
        "building_footprints_scope": "by_year_files",
        "latest_omits_building_footprints": True,
        "privacy": {
            "public_fields_only": True,
            "excludes": [
                "owner",
                "taxpayer",
                "private notes",
                "raw scrape payloads",
                "full parcel layer",
                "broad building footprint layer",
            ],
        },
        "schema": {
            "geometry": "matched KCMO parcel polygon where available; permit geocode point fallback otherwise; optional clipped Overture building footprints in feature properties",
            "properties": [
                "record_id",
                "case_number",
                "external_id",
                "status",
                "record_type",
                "category",
                "date",
                "activity_date",
                "activity_date_label",
                "activity_date_basis",
                "activity_stage",
                "timing_note",
                "apply_date",
                "issue_date",
                "final_date",
                "complete_date",
                "expiration_date",
                "scheduled_inspection_date",
                "scheduled_demolition_date",
                "story_angles",
                "year",
                "address",
                "parcel_id",
                "match_status",
                "match_method",
                "geometry_source",
                "has_parcel_polygon",
                "building_footprints",
                "detail_url",
            ],
        },
    }


def _json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_bundle(
    *,
    output_dir: Path,
    environment: str,
    public_base_url: str,
    latest_geojson: dict[str, Any],
    year_geojsons: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(output_dir / "by-year", ignore_errors=True)
    year_files: dict[str, str] = {}
    _json_write(output_dir / "latest.geojson", _without_building_footprints(latest_geojson))
    building_footprints_total = 0
    for year, geojson in sorted(year_geojsons.items()):
        features = geojson.get("features") if isinstance(geojson.get("features"), list) else []
        building_footprints_total += _building_footprint_count(features)
        rel_path = f"by-year/{year}.geojson"
        _json_write(output_dir / rel_path, geojson)
        year_files[year] = rel_path
    manifest = _manifest(
        environment=environment,
        latest_geojson=_without_building_footprints(latest_geojson),
        year_files=year_files,
        public_base_url=public_base_url,
        building_footprints_total=building_footprints_total,
    )
    _json_write(output_dir / "manifest.json", manifest)
    return manifest


def _load_source_bundle(source_url: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    latest_geojson = _sorted_geojson(_fetch_geojson(source_url))
    years = _available_years(latest_geojson)
    if not years:
        raise RuntimeError("CompassKC evergreen source returned no available years.")
    year_geojsons = {
        year: _sorted_geojson(_fetch_geojson(source_url, year=year))
        for year in years
    }
    return latest_geojson, year_geojsons


def _audit_json_file(path: Path, failures: list[str]) -> None:
    size = path.stat().st_size
    if size > MAX_PUBLIC_FILE_BYTES:
        failures.append(f"{path}: file is {size} bytes, above {MAX_PUBLIC_FILE_BYTES}")
    text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        for pattern in FORBIDDEN_PUBLIC_PATTERNS:
            if pattern.search(text):
                failures.append(f"{path}: matched forbidden public-data pattern {pattern.pattern!r}")
        failures.append(f"{path}: invalid JSON: {exc}")
        return

    scan_payload = payload
    if path.name == "manifest.json" and isinstance(payload, dict):
        # The manifest intentionally documents excluded private field classes.
        # Audit the rest of the manifest text so that endpoints, metadata, and
        # accidental payload fields are still checked.
        scan_payload = {key: value for key, value in payload.items() if key != "privacy"}
    scan_text = json.dumps(scan_payload, sort_keys=True)
    for pattern in FORBIDDEN_PUBLIC_PATTERNS:
        if pattern.search(scan_text):
            failures.append(f"{path}: matched forbidden public-data pattern {pattern.pattern!r}")

    if path.name == "manifest.json":
        for key in ("schema_version", "project", "environment", "generated_at", "data_version", "cache_ttl_seconds", "stale_after", "entrypoints"):
            if key not in payload:
                failures.append(f"{path}: missing manifest key {key!r}")
    if path.suffix == ".geojson":
        if payload.get("type") != "FeatureCollection":
            failures.append(f"{path}: expected GeoJSON FeatureCollection")
        for feature in payload.get("features") or []:
            props = feature.get("properties") if isinstance(feature, dict) and isinstance(feature.get("properties"), dict) else {}
            disallowed_keys = [key for key in props if re.search(r"(owner|taxpayer|raw|private)", key, re.I)]
            if disallowed_keys:
                failures.append(f"{path}: feature exposes disallowed property key(s): {', '.join(disallowed_keys)}")


def _audit_tree(root: Path, *, min_features: int) -> dict[str, Any]:
    failures: list[str] = []
    files = sorted([path for path in root.rglob("*") if path.is_file()])
    json_files = [path for path in files if path.suffix in {".json", ".geojson"}]
    for path in json_files:
        _audit_json_file(path, failures)

    prod_manifest_path = root / "prod" / "manifest.json"
    prod_latest_path = root / "prod" / "latest.geojson"
    if prod_manifest_path.exists() and prod_latest_path.exists():
        manifest = json.loads(prod_manifest_path.read_text(encoding="utf-8"))
        latest = json.loads(prod_latest_path.read_text(encoding="utf-8"))
        feature_count = len(latest.get("features") or [])
        if feature_count < min_features:
            failures.append(f"{prod_latest_path}: feature count {feature_count} is below minimum {min_features}")
        if manifest.get("features_total") != feature_count:
            failures.append(
                f"{prod_manifest_path}: features_total={manifest.get('features_total')} does not match latest count={feature_count}"
            )

    largest = sorted(
        [{"path": str(path), "bytes": path.stat().st_size} for path in files],
        key=lambda item: item["bytes"],
        reverse=True,
    )[:10]
    return {
        "ok": not failures,
        "failures": failures,
        "files_checked": len(files),
        "json_files_checked": len(json_files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "largest_files": largest,
    }


def refresh_public_data(
    *,
    repo_root: Path,
    source_url: str,
    promote_prod: bool,
    refresh_legacy_mirror: bool,
    min_features: int,
) -> dict[str, Any]:
    latest_geojson, year_geojsons = _load_source_bundle(source_url)
    project_root = repo_root / "maps" / DATASET_SLUG / "v1"

    testing_manifest = _write_bundle(
        output_dir=project_root / "testing",
        environment="testing",
        public_base_url=f"{PAGES_BASE_URL}/maps/{DATASET_SLUG}/v1/testing",
        latest_geojson=latest_geojson,
        year_geojsons=year_geojsons,
    )
    prod_manifest = None
    if promote_prod:
        prod_manifest = _write_bundle(
            output_dir=project_root / "prod",
            environment="prod",
            public_base_url=f"{PAGES_BASE_URL}/maps/{DATASET_SLUG}/v1/prod",
            latest_geojson=latest_geojson,
            year_geojsons=year_geojsons,
        )
    if refresh_legacy_mirror:
        _write_bundle(
            output_dir=repo_root / DATASET_SLUG,
            environment="prod",
            public_base_url=f"{RAW_BASE_URL}/{DATASET_SLUG}",
            latest_geojson=latest_geojson,
            year_geojsons=year_geojsons,
        )

    audit_root = project_root if promote_prod else project_root / "testing"
    audit = _audit_tree(audit_root, min_features=min_features)
    if not audit["ok"]:
        raise RuntimeError("Public data audit failed:\n" + "\n".join(audit["failures"]))
    return {
        "testing": {
            "features_total": testing_manifest.get("features_total"),
            "available_years": testing_manifest.get("available_years"),
            "building_footprints_total": testing_manifest.get("building_footprints_total"),
        },
        "prod": (
            {
                "features_total": prod_manifest.get("features_total"),
                "available_years": prod_manifest.get("available_years"),
                "building_footprints_total": prod_manifest.get("building_footprints_total"),
            }
            if prod_manifest
            else None
        ),
        "audit": audit,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh CompassKC demolition public data for GitHub Pages.")
    parser.add_argument("--repo-root", default=".", help="Path to the newsroom-data repository root.")
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--no-prod", action="store_true", help="Only write testing data; do not promote to prod.")
    parser.add_argument("--no-legacy-mirror", action="store_true", help="Do not refresh the temporary legacy flat folder.")
    parser.add_argument("--min-features", type=int, default=1)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    summary = refresh_public_data(
        repo_root=Path(args.repo_root).resolve(),
        source_url=args.source_url,
        promote_prod=not args.no_prod,
        refresh_legacy_mirror=not args.no_legacy_mirror,
        min_features=max(0, args.min_features),
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
