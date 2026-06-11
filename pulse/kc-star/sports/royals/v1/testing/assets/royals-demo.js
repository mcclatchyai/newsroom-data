(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CONTACT_COLORS = {
    home_run: "#cf3e3e",
    hit: "#1268b3",
    hard_out: "#c88f2d",
    out: "#5c6670",
    contact: "#2e856e",
  };
  const PITCH_COLORS = {
    whiff: "#cf3e3e",
    called_strike: "#1268b3",
    in_play: "#2e856e",
    ball: "#9f6b36",
    foul: "#7b5eb4",
    result: "#5c6670",
    other: "#7a838c",
  };
  const FIELD_COLORS = {
    grass: "#cfe2c3",
    grassStroke: "#9fbd90",
    dimensionLine: "#edf5e8",
    dimensionMarker: "#637d54",
    dimensionText: "#52685a",
    beyondWall: "#e8ddc8",
    wallTrack: "#d7b983",
    wall: "#4f6a47",
    dirt: "#c99052",
    dirtStroke: "#9f6b36",
    chalk: "#fffdf4",
    base: "#fffdf8",
    plateStroke: "#bfc7bd",
    zoneBg: "#fffdf8",
    zoneGrid: "#d6ddd5",
    plateFill: "#ead6b8",
  };
  const STATCAST_FIELD_TRANSFORM = {
    centerX: 125.42,
    centerY: 198.27,
  };
  const FIELD_GEOMETRY = {
    secondBaseDistanceFt: 127.279,
    pitcherPlateDistanceFt: 60.5,
    referenceFenceFt: {
      foulLine: 325,
      gap: 375,
      center: 400,
    },
    view: {
      width: 760,
      height: 560,
      leftFt: -330,
      rightFt: 330,
      topFt: 455,
      bottomFt: -35,
    },
  };
  const PITCH_GEOMETRY = {
    view: {
      width: 520,
      height: 480,
      leftFt: -2.2,
      rightFt: 2.2,
      topFt: 4.8,
      bottomFt: 0.5,
    },
    plateHalfWidthReferenceFt: 0.83,
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      node.append(child);
    }
    return node;
  }

  function svgEl(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    for (const child of children) {
      node.append(child);
    }
    return node;
  }

  function fmt(value, suffix = "") {
    if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
    return `${value}${suffix}`;
  }

  function label(value) {
    if (!value) return "Unknown";
    return String(value).replaceAll("_", " ");
  }

  function showTooltip(tooltip, html, event) {
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 280)}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  }

  function hideTooltip(tooltip) {
    tooltip.style.display = "none";
  }

  function statcastToField(event) {
    if (event.hit_distance_sc === null || event.hit_distance_sc === undefined) return null;
    const sprayAngleRadians = Math.atan2(
      event.hc_x - STATCAST_FIELD_TRANSFORM.centerX,
      STATCAST_FIELD_TRANSFORM.centerY - event.hc_y,
    );
    const fieldX = Math.sin(sprayAngleRadians) * event.hit_distance_sc;
    const fieldY = Math.cos(sprayAngleRadians) * event.hit_distance_sc;
    return { x: fieldX, y: fieldY };
  }

  function fieldToSvg(xFt, yFt, view = FIELD_GEOMETRY.view) {
    return {
      x: ((xFt - view.leftFt) / (view.rightFt - view.leftFt)) * view.width,
      y: ((view.topFt - yFt) / (view.topFt - view.bottomFt)) * view.height,
    };
  }

  function polarFieldPoint(angleDegrees, distanceFt) {
    const radians = angleDegrees * Math.PI / 180;
    return {
      x: Math.sin(radians) * distanceFt,
      y: Math.cos(radians) * distanceFt,
    };
  }

  function pathPoint(point) {
    return `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }

  function dimensionPointToSvg(dimension) {
    const field = polarFieldPoint(dimension.angle_degrees, dimension.distance_ft);
    return fieldToSvg(field.x, field.y);
  }

  function pathFromPoints(points) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${pathPoint(point)}`).join(" ");
  }

  function beyondWallPath(points, view = FIELD_GEOMETRY.view) {
    return `${pathFromPoints(points)} L ${view.width} 0 L 0 0 Z`;
  }

  function contactPoint(event) {
    const field = event.field_x_ft !== null && event.field_y_ft !== null
      ? { x: event.field_x_ft, y: event.field_y_ft }
      : statcastToField(event);
    return field ? fieldToSvg(field.x, field.y) : null;
  }

  function drawField(svg, venueProfile) {
    const home = fieldToSvg(0, 0);
    const first = fieldToSvg(63.64, 63.64);
    const second = fieldToSvg(0, FIELD_GEOMETRY.secondBaseDistanceFt);
    const third = fieldToSvg(-63.64, 63.64);
    const mound = fieldToSvg(0, FIELD_GEOMETRY.pitcherPlateDistanceFt);
    const dimensions = venueProfile?.dimensions || [
      { label: "LF", angle_degrees: -45, distance_ft: 330 },
      { label: "CF", angle_degrees: 0, distance_ft: 410 },
      { label: "RF", angle_degrees: 45, distance_ft: 330 },
    ];
    const leftFoulDimension = dimensions[0];
    const rightFoulDimension = dimensions[dimensions.length - 1];
    const leftFoulField = polarFieldPoint(leftFoulDimension.angle_degrees, leftFoulDimension.distance_ft);
    const rightFoulField = polarFieldPoint(rightFoulDimension.angle_degrees, rightFoulDimension.distance_ft);
    const leftFoul = fieldToSvg(leftFoulField.x, leftFoulField.y);
    const rightFoul = fieldToSvg(rightFoulField.x, rightFoulField.y);
    const basepath = `M ${pathPoint(home)} L ${pathPoint(first)} L ${pathPoint(second)} L ${pathPoint(third)} Z`;
    const wallPoints = dimensions.map((dimension) => dimensionPointToSvg(dimension));
    const wallPath = pathFromPoints(wallPoints);
    const outOfPlayPath = beyondWallPath(wallPoints);
    const dimensionGroups = dimensions.map((dimension) => {
      const point = dimensionPointToSvg(dimension);
      return svgEl("g", {}, [
        svgEl("line", { x1: home.x.toFixed(1), y1: home.y.toFixed(1), x2: point.x.toFixed(1), y2: point.y.toFixed(1), stroke: FIELD_COLORS.dimensionLine, "stroke-width": 1 }),
        svgEl("circle", { cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: 4, fill: FIELD_COLORS.dimensionMarker, stroke: FIELD_COLORS.chalk, "stroke-width": 1.4 }),
        svgEl("text", { x: point.x.toFixed(1), y: (point.y - 8).toFixed(1), "text-anchor": "middle", fill: FIELD_COLORS.dimensionText, "font-size": 10 }, [document.createTextNode(`${dimension.label} ${dimension.distance_ft}`)]),
      ]);
    });

    svg.append(
      svgEl("rect", { x: 0, y: 0, width: 760, height: 560, fill: FIELD_COLORS.grass }),
      svgEl("path", { d: outOfPlayPath, fill: FIELD_COLORS.beyondWall }),
      svgEl("path", {
        d: wallPath,
        fill: "none",
        stroke: FIELD_COLORS.wallTrack,
        "stroke-width": 13,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("path", {
        d: wallPath,
        fill: "none",
        stroke: FIELD_COLORS.wall,
        "stroke-width": 4,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("path", {
        d: `M ${pathPoint(home)} L ${pathPoint(leftFoul)} M ${pathPoint(home)} L ${pathPoint(rightFoul)}`,
        fill: "none",
        stroke: FIELD_COLORS.chalk,
        "stroke-width": 3,
      }),
      ...dimensionGroups,
      svgEl("path", {
        d: basepath,
        fill: "none",
        stroke: FIELD_COLORS.dirt,
        "stroke-width": 17,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }),
      svgEl("path", { d: basepath, fill: "none", stroke: FIELD_COLORS.chalk, "stroke-width": 2, "stroke-linejoin": "round" }),
      svgEl("circle", { cx: mound.x.toFixed(1), cy: mound.y.toFixed(1), r: 11, fill: FIELD_COLORS.dirt, stroke: FIELD_COLORS.dirtStroke }),
      svgEl("line", { x1: (mound.x - 10).toFixed(1), y1: mound.y.toFixed(1), x2: (mound.x + 10).toFixed(1), y2: mound.y.toFixed(1), stroke: FIELD_COLORS.chalk, "stroke-width": 3 }),
      svgEl("rect", { x: (first.x - 4).toFixed(1), y: (first.y - 4).toFixed(1), width: 8, height: 8, fill: FIELD_COLORS.base, transform: `rotate(45 ${first.x.toFixed(1)} ${first.y.toFixed(1)})` }),
      svgEl("rect", { x: (second.x - 4).toFixed(1), y: (second.y - 4).toFixed(1), width: 8, height: 8, fill: FIELD_COLORS.base, transform: `rotate(45 ${second.x.toFixed(1)} ${second.y.toFixed(1)})` }),
      svgEl("rect", { x: (third.x - 4).toFixed(1), y: (third.y - 4).toFixed(1), width: 8, height: 8, fill: FIELD_COLORS.base, transform: `rotate(45 ${third.x.toFixed(1)} ${third.y.toFixed(1)})` }),
      svgEl("path", {
        d: `M ${(home.x - 6).toFixed(1)} ${(home.y - 2).toFixed(1)} H ${(home.x + 6).toFixed(1)} L ${(home.x + 5).toFixed(1)} ${(home.y + 7).toFixed(1)} L ${home.x.toFixed(1)} ${(home.y + 10).toFixed(1)} L ${(home.x - 5).toFixed(1)} ${(home.y + 7).toFixed(1)} Z`,
        fill: FIELD_COLORS.base,
        stroke: FIELD_COLORS.plateStroke,
      }),
    );
  }

  function drawContactMap(container, data, filter) {
    container.innerHTML = "";
    const tooltip = document.querySelector(".pulse-royals-tooltip");
    const svg = svgEl("svg", { viewBox: "0 0 760 560", role: "img", "aria-label": "Batted-ball contact map" });
    drawField(svg, data.game.venue_dimensions);
    const events = data.events.contact.filter((event) => filter === "all" || event.team_abbr === filter);
    for (const event of events) {
      const point = contactPoint(event);
      if (!point) continue;
      const radius = event.launch_speed !== null ? Math.max(5, Math.min(13, event.launch_speed / 9)) : 6;
      const circle = svgEl("circle", {
        cx: point.x.toFixed(1),
        cy: point.y.toFixed(1),
        r: radius.toFixed(1),
        fill: CONTACT_COLORS[event.class_name] || CONTACT_COLORS.contact,
        stroke: "#fff",
        "stroke-width": 1.8,
        opacity: event.team_abbr === "KC" ? 0.95 : 0.82,
        tabindex: 0,
      });
      const tip = `<strong>${event.batter_name}</strong><br>${event.team_abbr} · ${label(event.result)} · ${event.half} ${event.inning}<br>EV ${fmt(event.launch_speed, " mph")} · LA ${fmt(event.launch_angle, "°")} · ${label(event.bb_type)}`;
      circle.addEventListener("mousemove", (mouseEvent) => showTooltip(tooltip, tip, mouseEvent));
      circle.addEventListener("mouseleave", () => hideTooltip(tooltip));
      circle.addEventListener("focus", (focusEvent) => showTooltip(tooltip, tip, focusEvent));
      circle.addEventListener("blur", () => hideTooltip(tooltip));
      svg.append(circle);
    }
    container.append(svg);
  }

  function pitchPoint(event) {
    return pitchToSvg(event.plate_x, event.plate_z);
  }

  function pitchToSvg(xFt, zFt, view = PITCH_GEOMETRY.view) {
    return {
      x: ((xFt - view.leftFt) / (view.rightFt - view.leftFt)) * view.width,
      y: ((view.topFt - zFt) / (view.topFt - view.bottomFt)) * view.height,
    };
  }

  function drawPitchZone(container, data, filter) {
    container.innerHTML = "";
    const tooltip = document.querySelector(".pulse-royals-tooltip");
    const svg = svgEl("svg", { viewBox: "0 0 520 480", role: "img", "aria-label": "Pitch location zone chart" });
    const zoneTop = data.summary.pitch_zone?.median_sz_top_ft || 3.5;
    const zoneBot = data.summary.pitch_zone?.median_sz_bot_ft || 1.5;
    const halfWidth = data.summary.pitch_zone?.plate_half_width_reference_ft || PITCH_GEOMETRY.plateHalfWidthReferenceFt;
    const zoneTopLeft = pitchToSvg(-halfWidth, zoneTop);
    const zoneBottomRight = pitchToSvg(halfWidth, zoneBot);
    const zone = {
      x: zoneTopLeft.x,
      y: zoneTopLeft.y,
      w: zoneBottomRight.x - zoneTopLeft.x,
      h: zoneBottomRight.y - zoneTopLeft.y,
    };
    const plateLeft = pitchToSvg(-0.708, 0.78);
    const plateRight = pitchToSvg(0.708, 0.78);
    const platePoint = pitchToSvg(0, 0.56);
    svg.append(
      svgEl("rect", { x: 0, y: 0, width: 520, height: 480, fill: FIELD_COLORS.zoneBg }),
      svgEl("rect", { x: zone.x, y: zone.y, width: zone.w, height: zone.h, fill: "#ffffff", stroke: "#17212b", "stroke-width": 2 }),
      svgEl("line", { x1: zone.x + zone.w / 3, y1: zone.y, x2: zone.x + zone.w / 3, y2: zone.y + zone.h, stroke: FIELD_COLORS.zoneGrid }),
      svgEl("line", { x1: zone.x + (zone.w * 2) / 3, y1: zone.y, x2: zone.x + (zone.w * 2) / 3, y2: zone.y + zone.h, stroke: FIELD_COLORS.zoneGrid }),
      svgEl("line", { x1: zone.x, y1: zone.y + zone.h / 3, x2: zone.x + zone.w, y2: zone.y + zone.h / 3, stroke: FIELD_COLORS.zoneGrid }),
      svgEl("line", { x1: zone.x, y1: zone.y + (zone.h * 2) / 3, x2: zone.x + zone.w, y2: zone.y + (zone.h * 2) / 3, stroke: FIELD_COLORS.zoneGrid }),
      svgEl("path", { d: `M ${plateLeft.x.toFixed(1)} ${plateLeft.y.toFixed(1)} H ${plateRight.x.toFixed(1)} L ${(plateRight.x - 21).toFixed(1)} ${(plateRight.y + 35).toFixed(1)} L ${platePoint.x.toFixed(1)} ${platePoint.y.toFixed(1)} L ${(plateLeft.x + 21).toFixed(1)} ${(plateLeft.y + 35).toFixed(1)} Z`, fill: FIELD_COLORS.plateFill, stroke: FIELD_COLORS.dirtStroke }),
      svgEl("text", { x: 260, y: 455, "text-anchor": "middle", fill: "#5c6670", "font-size": 13 }, [document.createTextNode("Catcher view · median batter zone")]),
    );

    const events = data.events.pitches.filter((event) => {
      if (filter === "all") return true;
      if (filter === "royals-batting") return event.batter_team_abbr === "KC";
      if (filter === "royals-pitching") return event.pitching_team_abbr === "KC";
      return true;
    });
    for (const event of events) {
      const point = pitchPoint(event);
      const circle = svgEl("circle", {
        cx: point.x.toFixed(1),
        cy: point.y.toFixed(1),
        r: event.class_name === "in_play" ? 5.8 : 4.4,
        fill: PITCH_COLORS[event.class_name] || PITCH_COLORS.other,
        opacity: 0.76,
        stroke: "#fff",
        "stroke-width": 1,
        tabindex: 0,
      });
      const tip = `<strong>${event.pitch_name}</strong><br>${event.pitcher_name} vs. ${event.batter_name}<br>${label(event.description)}${event.result ? ` · ${label(event.result)}` : ""}<br>${fmt(event.release_speed, " mph")}`;
      circle.addEventListener("mousemove", (mouseEvent) => showTooltip(tooltip, tip, mouseEvent));
      circle.addEventListener("mouseleave", () => hideTooltip(tooltip));
      circle.addEventListener("focus", (focusEvent) => showTooltip(tooltip, tip, focusEvent));
      circle.addEventListener("blur", () => hideTooltip(tooltip));
      svg.append(circle);
    }
    container.append(svg);
  }

  function teamLine(team) {
    return el("div", { class: "pulse-royals-score-row" }, [
      el("span", {}, [document.createTextNode(team.abbreviation)]),
      el("strong", {}, [document.createTextNode(String(team.score))]),
    ]);
  }

  function fact(labelText, valueText) {
    return el("div", { class: "pulse-royals-fact" }, [
      el("span", {}, [document.createTextNode(labelText)]),
      el("strong", {}, [document.createTextNode(valueText)]),
    ]);
  }

  function legend(items) {
    return el("div", { class: "pulse-royals-legend" }, items.map(([text, color]) =>
      el("span", {}, [
        el("i", { class: "pulse-royals-dot", style: `background:${color}` }),
        document.createTextNode(text),
      ]),
    ));
  }

  function render(root, data) {
    let contactFilter = "all";
    let pitchFilter = "all";
    const tooltip = el("div", { class: "pulse-royals-tooltip", role: "tooltip" });
    const contactChart = el("div", { class: "pulse-royals-chart-wrap" });
    const pitchChart = el("div", { class: "pulse-royals-chart-wrap pulse-royals-zone-wrap" });

    const contactControls = el("div", { class: "pulse-royals-controls", "aria-label": "Contact map filters" });
    const pitchControls = el("div", { class: "pulse-royals-controls", "aria-label": "Pitch zone filters" });

    function updateContactButtons() {
      contactControls.querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.filter === contactFilter ? "true" : "false");
      });
    }

    function updatePitchButtons() {
      pitchControls.querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.filter === pitchFilter ? "true" : "false");
      });
    }

    [
      ["all", "All contact"],
      [data.game.home_team.abbreviation, "Royals"],
      [data.game.away_team.abbreviation, data.game.away_team.abbreviation],
    ].forEach(([filterValue, text]) => {
      const button = el("button", { type: "button", "data-filter": filterValue, "aria-pressed": filterValue === contactFilter ? "true" : "false" }, [document.createTextNode(text)]);
      button.addEventListener("click", () => {
        contactFilter = filterValue;
        updateContactButtons();
        drawContactMap(contactChart, data, contactFilter);
      });
      contactControls.append(button);
    });

    [
      ["all", "All pitches"],
      ["royals-batting", "Royals batters"],
      ["royals-pitching", "Royals pitchers"],
    ].forEach(([filterValue, text]) => {
      const button = el("button", { type: "button", "data-filter": filterValue, "aria-pressed": filterValue === pitchFilter ? "true" : "false" }, [document.createTextNode(text)]);
      button.addEventListener("click", () => {
        pitchFilter = filterValue;
        updatePitchButtons();
        drawPitchZone(pitchChart, data, pitchFilter);
      });
      pitchControls.append(button);
    });

    const teamSummary = Object.values(data.summary.teams || {});
    const storyFits = [
      ["Postgame recap", "Attach a quick field view showing where damage came from and what deserves a reporter follow-up."],
      ["Injury or scary-contact follow-up", "Flag hard-hit balls, exit velocity and context without asking the reporter to rebuild a chart by hand."],
      ["Roster or player trend story", "Reuse the same renderer across rolling windows for Bobby Witt Jr., Salvador Perez, prospects or opposing pitchers."],
      ["Editor handoff", "Send a preview link, source note and caveat with the morning or postgame desk readout."],
    ];
    const feedbackQuestions = [
      "Would this help a Royals recap or follow-up?",
      "What should the color encode: result, run value, exit velocity or something else?",
      "Would you want a PNG/SVG, CUE embed or dashboard link?",
    ];
    const methodNotes = [
      ["Field geometry", "The base square uses 90-foot baselines; the mound marker is placed at 60 feet 6 inches from home plate."],
      ["Batted-ball placement", "Locations use Statcast hit distance in feet plus spray angle derived from hc_x/hc_y."],
      ["Outfield wall", "The dark wall line connects published Kauffman Stadium dimension points for the season of the game; it is exact at labeled markers and intentionally avoids claiming a surveyed wall trace between them."],
      ["Pitch zone", "Pitches use Statcast plate_x/plate_z in feet with a median batter strike-zone reference from sz_top/sz_bot."],
    ];

    root.innerHTML = "";
    root.append(
      tooltip,
      el("section", { class: "pulse-royals-frame" }, [
        el("header", { class: "pulse-royals-header" }, [
          el("div", {}, [
            el("p", { class: "pulse-royals-kicker" }, [document.createTextNode("Internal prototype · KC Star sports visual asset pipeline")]),
            el("h1", { class: "pulse-royals-title" }, [document.createTextNode("Royals Postgame Contact And Pitch-Zone Demo")]),
            el("p", { class: "pulse-royals-subtitle" }, [document.createTextNode("A reusable sample for game recap, injury follow-up and player-trend visuals. Built as a static CUE-style asset backed by public JSON.")]),
          ]),
          el("aside", { class: "pulse-royals-score", "aria-label": "Final score" }, [
            teamLine(data.game.away_team),
            teamLine(data.game.home_team),
            el("div", { class: "pulse-royals-status" }, [document.createTextNode(`${data.game.status} · ${data.game.date}`)]),
          ]),
        ]),
        el("section", { class: "pulse-royals-facts", "aria-label": "Demo metrics" }, [
          fact("Tracked pitches", String(data.summary.pitches)),
          fact("Batted balls", String(data.summary.batted_balls)),
          fact("Hard-hit balls", String(data.summary.hard_hit)),
          fact("Whiffs", String(data.summary.whiffs)),
        ]),
        el("section", { class: "pulse-royals-body" }, [
          el("article", { class: "pulse-royals-panel" }, [
            el("div", { class: "pulse-royals-panel-header" }, [
              el("div", {}, [
                el("h2", {}, [document.createTextNode("Contact Map")]),
                el("p", {}, [document.createTextNode("Each dot is a batted ball, positioned by Statcast field coordinates and sized by exit velocity.")]),
              ]),
              contactControls,
            ]),
            contactChart,
            legend([
              ["Home run", CONTACT_COLORS.home_run],
              ["Hit", CONTACT_COLORS.hit],
              ["Hard out", CONTACT_COLORS.hard_out],
              ["Other out/contact", CONTACT_COLORS.out],
            ]),
          ]),
          el("aside", { class: "pulse-royals-sidebar" }, [
            el("article", { class: "pulse-royals-panel" }, [
              el("div", { class: "pulse-royals-panel-header" }, [
                el("div", {}, [
                  el("h2", {}, [document.createTextNode("Pitch Zone")]),
                  el("p", {}, [document.createTextNode("Catcher-view pitch locations, colored by pitch result.")]),
                ]),
                pitchControls,
              ]),
              pitchChart,
              legend([
                ["Whiff", PITCH_COLORS.whiff],
                ["Called strike", PITCH_COLORS.called_strike],
                ["In play", PITCH_COLORS.in_play],
                ["Ball", PITCH_COLORS.ball],
              ]),
            ]),
            el("article", { class: "pulse-royals-panel" }, [
              el("h3", {}, [document.createTextNode("Where This Fits KC Star Coverage")]),
              el("ul", { class: "pulse-royals-list" }, storyFits.map(([heading, text]) =>
                el("li", {}, [
                  el("strong", {}, [document.createTextNode(heading)]),
                  el("span", {}, [document.createTextNode(text)]),
                ]),
              )),
            ]),
            el("article", { class: "pulse-royals-panel" }, [
              el("h3", {}, [document.createTextNode("Reporter Feedback Prompt")]),
              el("ul", { class: "pulse-royals-list" }, feedbackQuestions.map((question) =>
                el("li", {}, [
                  el("strong", {}, [document.createTextNode(question)]),
                ]),
              )),
            ]),
            el("article", { class: "pulse-royals-panel" }, [
              el("h3", {}, [document.createTextNode("Visualization Method")]),
              el("ul", { class: "pulse-royals-list" }, methodNotes.map(([heading, text]) =>
                el("li", {}, [
                  el("strong", {}, [document.createTextNode(heading)]),
                  el("span", {}, [document.createTextNode(text)]),
                ]),
              )),
            ]),
            el("article", { class: "pulse-royals-panel" }, [
              el("h3", {}, [document.createTextNode("Team Contact Snapshot")]),
              el("ul", { class: "pulse-royals-list" }, teamSummary.map((team) =>
                el("li", {}, [
                  el("strong", {}, [document.createTextNode(`${team.team_abbr}: ${team.batted_balls} balls in play, ${team.hard_hit} hard-hit`)]),
                  el("span", {}, [document.createTextNode(`Hits ${team.hits}; average exit velocity ${fmt(team.avg_exit_velocity, " mph")}`)]),
                ]),
              )),
            ]),
          ]),
        ]),
        el("p", { class: "pulse-royals-note" }, [document.createTextNode("Rights note: this is an internal/sample technical demo. Public publishing of derived visuals should wait for McClatchy source and licensing review.")]),
        el("footer", { class: "pulse-royals-footer" }, [
          document.createTextNode("Sources: MLB Stats API schedule and boxscore metadata; Baseball Savant Statcast CSV. Data shown is a historical fixture because the same-day 2026 Statcast endpoint returned no usable rows during the build. Field contact locations use Statcast hit distance plus spray angle derived from hc_x/hc_y. The outfield wall line connects season-specific published Kauffman Stadium dimension points; it is exact at labeled markers, not a surveyed trace between them."),
        ]),
      ]),
    );

    drawContactMap(contactChart, data, contactFilter);
    drawPitchZone(pitchChart, data, pitchFilter);
  }

  async function boot(root) {
    const dataUrl = root.dataset.dataUrl || "data/game.json";
    root.innerHTML = '<div class="pulse-royals-loading">Loading Royals visual demo...</div>';
    try {
      const response = await fetch(dataUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
      const data = await response.json();
      render(root, data);
    } catch (error) {
      root.innerHTML = `<div class="pulse-royals-error"><strong>Demo unavailable.</strong><br>${error.message}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".pulse-royals-demo").forEach(boot);
  });
})();
