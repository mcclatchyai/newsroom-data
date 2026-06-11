(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CONTACT_COLORS = {
    home_run: "#b94141",
    hit: "#1f5f9f",
    hard_out: "#b7842a",
    out: "#5c6773",
    contact: "#317b58",
  };
  const PITCH_COLORS = {
    whiff: "#b94141",
    called_strike: "#1f5f9f",
    in_play: "#317b58",
    ball: "#a5742b",
    foul: "#6a55a3",
    result: "#5c6773",
    other: "#7b8793",
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

  function contactPoint(event) {
    const width = 760;
    const height = 560;
    const plateX = width / 2;
    const plateY = height - 55;
    const scale = 2.22;
    return {
      x: plateX + (event.hc_x - 125) * scale,
      y: plateY - (199 - event.hc_y) * scale,
    };
  }

  function drawField(svg) {
    svg.append(
      svgEl("rect", { x: 0, y: 0, width: 760, height: 560, fill: "#dbe8d2" }),
      svgEl("path", {
        d: "M380 505 L96 188 Q380 22 664 188 Z",
        fill: "#c7ddbb",
        stroke: "#9fba97",
        "stroke-width": 2,
      }),
      svgEl("path", {
        d: "M380 505 L243 368 L380 232 L517 368 Z",
        fill: "#d8b37d",
        stroke: "#b89058",
        "stroke-width": 2,
      }),
      svgEl("path", { d: "M380 505 L96 188", stroke: "#f8f8f2", "stroke-width": 3 }),
      svgEl("path", { d: "M380 505 L664 188", stroke: "#f8f8f2", "stroke-width": 3 }),
      svgEl("path", { d: "M243 368 L380 232 L517 368", fill: "none", stroke: "#ffffff", "stroke-width": 2 }),
      svgEl("circle", { cx: 380, cy: 361, r: 16, fill: "#c79c64" }),
      svgEl("rect", { x: 372, y: 497, width: 16, height: 16, fill: "#fff", transform: "rotate(45 380 505)" }),
      svgEl("text", { x: 380, y: 38, "text-anchor": "middle", fill: "#557150", "font-size": 14 }, [document.createTextNode("Outfield")]),
      svgEl("text", { x: 380, y: 535, "text-anchor": "middle", fill: "#755a32", "font-size": 12 }, [document.createTextNode("Home plate")]),
    );
  }

  function drawContactMap(container, data, filter) {
    container.innerHTML = "";
    const tooltip = document.querySelector(".pulse-royals-tooltip");
    const svg = svgEl("svg", { viewBox: "0 0 760 560", role: "img", "aria-label": "Batted-ball contact map" });
    drawField(svg);
    const events = data.events.contact.filter((event) => filter === "all" || event.team_abbr === filter);
    for (const event of events) {
      const point = contactPoint(event);
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
    const width = 520;
    const height = 480;
    const margin = { left: 62, right: 28, top: 28, bottom: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    return {
      x: margin.left + ((event.plate_x + 2.5) / 5) * plotW,
      y: margin.top + ((4.8 - event.plate_z) / 4.4) * plotH,
    };
  }

  function drawPitchZone(container, data, filter) {
    container.innerHTML = "";
    const tooltip = document.querySelector(".pulse-royals-tooltip");
    const svg = svgEl("svg", { viewBox: "0 0 520 480", role: "img", "aria-label": "Pitch location zone chart" });
    svg.append(svgEl("rect", { x: 0, y: 0, width: 520, height: 480, fill: "#fbfaf7" }));
    const zone = { x: 170, y: 116, w: 180, h: 228 };
    svg.append(
      svgEl("rect", { x: zone.x, y: zone.y, width: zone.w, height: zone.h, fill: "#fff", stroke: "#17212b", "stroke-width": 2 }),
      svgEl("line", { x1: zone.x + zone.w / 3, y1: zone.y, x2: zone.x + zone.w / 3, y2: zone.y + zone.h, stroke: "#d8ded7" }),
      svgEl("line", { x1: zone.x + (zone.w * 2) / 3, y1: zone.y, x2: zone.x + (zone.w * 2) / 3, y2: zone.y + zone.h, stroke: "#d8ded7" }),
      svgEl("line", { x1: zone.x, y1: zone.y + zone.h / 3, x2: zone.x + zone.w, y2: zone.y + zone.h / 3, stroke: "#d8ded7" }),
      svgEl("line", { x1: zone.x, y1: zone.y + (zone.h * 2) / 3, x2: zone.x + zone.w, y2: zone.y + (zone.h * 2) / 3, stroke: "#d8ded7" }),
      svgEl("path", { d: "M205 388 H315 L292 425 H228 Z", fill: "#e7d3b1", stroke: "#b89058" }),
      svgEl("text", { x: 260, y: 455, "text-anchor": "middle", fill: "#5c6773", "font-size": 13 }, [document.createTextNode("Catcher view")]),
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
          document.createTextNode("Sources: MLB Stats API schedule and boxscore metadata; Baseball Savant Statcast CSV. Data shown is a historical fixture because the same-day 2026 Statcast endpoint returned no usable rows during the build."),
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
