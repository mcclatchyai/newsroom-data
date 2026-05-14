# Newsroom Data

Static public data files for newsroom maps and story embeds.

## Datasets

- `compasskc-demolitions/` - Sanitized GeoJSON for Kansas City CompassKC demolition permit maps.

## Publishing Contract

- Publish only fields needed by reader-facing maps.
- Do not include owner/taxpayer fields, raw scrape payloads, private notes, credentials, or full parcel layers.
- Keep paths stable so CUE/WPS embeds can fetch the same URL after story publication.
- Prefer `manifest.json`, `latest.geojson`, and scoped folders such as `by-year/`.
