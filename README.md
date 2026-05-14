# Newsroom Data

Static public data files for newsroom maps and story embeds.

## Datasets

- `compasskc-demolitions/` - Sanitized GeoJSON and Leaflet embed assets for Kansas City CompassKC demolition permit maps.

## CompassKC Demolitions

- `compasskc-demolitions/manifest.json` lists the current files, available years, and public schema.
- `compasskc-demolitions/latest.geojson` contains every currently exported mapped demolition record.
- `compasskc-demolitions/by-year/{year}.geojson` contains year-filtered exports.
- `compasskc-demolitions/embed.html` is the CUE/WPS-ready Leaflet embed. It fetches this repository's public raw `manifest.json`.
- `compasskc-demolitions/preview.html` is a browser preview and includes the CMS embed code.

## Publishing Contract

- Publish only fields needed by reader-facing maps.
- Do not include owner/taxpayer fields, raw scrape payloads, private notes, credentials, or full parcel layers.
- Keep paths stable so CUE/WPS embeds can fetch the same URL after story publication.
- Prefer `manifest.json`, `latest.geojson`, and scoped folders such as `by-year/`.
