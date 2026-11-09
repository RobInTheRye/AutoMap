# AutoMap — automated thematic maps

A minimal, dependency-free static web app that builds thematic (choropleth) maps
from pre-defined administrative boundaries.

## Features

- **Admin boundaries**: select a country and administrative level —
  ADM1 (regions/provinces), ADM2 (districts/counties) or ADM3 (municipalities).
  Boundaries come live from the [geoBoundaries](https://www.geoboundaries.org)
  open database (CC BY 4.0).
- **Data visualisation**: paste `name,value` rows (one per boundary) and the app
  joins them to the shapes by name and renders a choropleth. A "random demo data"
  button lets you preview instantly.
- **Legend**: auto-generated from the data — classed (quantiles / equal
  intervals) or continuous gradient, with a no-data class. Title, position and
  visibility are customisable.
- **Scale bar**: metric / imperial, any corner, toggleable.
- **North arrow**: three styles (classic arrow, compass rose, half needle),
  custom colour, size and position.
- **Also customisable**: colour palettes (Viridis, Inferno, Blues, Greens,
  Orange–Red, Red–Yellow–Blue or a custom two-colour gradient), number of
  classes, classification method, boundary stroke colour/width, fill opacity,
  name labels, map title/subtitle, and background (plain or OpenStreetMap).
- **Export**: one-click PNG export of the map with legend, scale, north arrow,
  title and attribution rendered onto the canvas.

## Run

No build step. Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8080
```

then open <http://localhost:8080>. Requires internet access in the browser
(Leaflet from CDN, boundaries from geoBoundaries / GitHub).

## Attribution

Boundary data: geoBoundaries (Runfola et al. 2020, PLoS ONE) — CC BY 4.0.
Keep the on-map attribution when exporting.
