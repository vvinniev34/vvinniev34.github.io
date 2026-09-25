/* ============================================================================
   resume.js — THE ONLY FILE YOU NEED TO EDIT.
   ----------------------------------------------------------------------------
   Everything on the site is rendered from the object below. Change a value,
   save, refresh the browser. No build step, no npm, nothing to install.

   Text fields support a little inline markdown:
       **bold**      *italic*      `code`      [link text](https://url.com)

   Sections render in the order they appear in the `sections` array below.
   Reorder them, delete them, or add new ones. Four section types exist:

       type: "prose"    → paragraphs of text
       type: "entries"  → jobs / roles, with bullets  (the big timeline blocks)
       type: "index"    → compact one-line rows       (writing, talks, awards)
       type: "grid"     → labelled groups of keywords (skills, tools)

   Any field you don't want, just delete — it disappears from the page.
   ========================================================================== */

const RESUME = {

  /* ---- identity ---------------------------------------------------------- */

  name: "Vincent Liu",
  role: "Software Engineer",
  // Shown next to your role, small and muted. Delete the line to hide it.
  location: "San Francisco, CA",

  // Browser tab title. Falls back to "Name — Role" if you delete this.
  pageTitle: "Vincent Liu",
  // Used for search results and link previews. One clear sentence.
  description: "Vincent Liu is a software engineer working on distributed systems and developer tooling.",

  // The single accent colour used across the whole site. Try:
  //   "#b4451f" rust · "#1d4ed8" blue · "#15803d" green · "#7c3aed" violet
  accent: "#b4451f",

  /* ---- opening paragraphs ------------------------------------------------ */
  // Keep this short. Two or three sentences that say what you actually do.

  intro: [
    "I'm a software engineer at **Meta**, where I work on distributed systems and the tooling that keeps them honest. Most of my time goes to making slow things fast and complicated things boring.",
    "Before that I was at Acme, building data infrastructure. I care about systems that are legible to the people who have to operate them at 3am.",
  ],

  /* ---- the "currently" line ---------------------------------------------- */
  // A pulsing dot, one line of text, and — if you set `githubUser` — your most
  // recent public push, fetched live. Delete either field to hide that half.

  now: "Currently building developer tooling at Meta.",
  githubUser: "vvinniev34",

  /* ---- links shown under the intro --------------------------------------- */
  // `action: "print"` turns the link into a "print this page as a PDF résumé"
  // button — the page has a print stylesheet that makes it look like a résumé.

  links: [
    { label: "GitHub",   url: "https://github.com/vvinniev34" },
    { label: "LinkedIn", url: "https://linkedin.com/in/your-handle" },
    { label: "Email",    url: "mailto:you@example.com" },
    { label: "Résumé",   action: "print" },
  ],

  /* ---- the body of the page ---------------------------------------------- */

  sections: [

    {
      type: "entries",
      label: "Experience",
      items: [
        {
          org: "Meta",
          role: "Software Engineer",
          period: "2023 — Present",
          url: "https://meta.com",           // optional, makes the org a link
          bullets: [
            "Rebuilt the caching layer behind a service handling 40k req/s, cutting p99 latency from 180ms to 24ms.",
            "Designed and shipped the migration tooling that moved 200+ services off a deprecated RPC framework.",
            "Mentor two interns and run the team's design review rotation.",
          ],
          tags: ["C++", "Python", "Thrift", "Distributed systems"],
        },
        {
          org: "Acme Corp",
          role: "Software Engineer",
          period: "2021 — 2023",
          bullets: [
            "Built the ingestion pipeline processing 2TB/day of event data with exactly-once semantics.",
            "Took the deploy process from a 45-minute manual checklist to a 6-minute automated pipeline.",
          ],
          tags: ["Go", "Kafka", "Kubernetes"],
        },
        {
          org: "Acme Corp",
          role: "Software Engineering Intern",
          period: "Summer 2020",
          bullets: [
            "Prototyped an internal query explorer that shipped to 300 weekly users.",
          ],
        },
      ],
    },

    {
      type: "entries",
      label: "Projects",
      items: [
        {
          org: "littlefs-viz",
          role: "Filesystem inspector for embedded devices",
          period: "2025",
          url: "https://github.com/vvinniev34/littlefs-viz",
          bullets: [
            "A single-binary tool that renders littlefs block allocation as a live heatmap. ~900 stars.",
          ],
          tags: ["Rust", "WebAssembly"],
        },
        {
          org: "pg-slowlog",
          role: "Postgres query profiler",
          period: "2024",
          url: "https://github.com/vvinniev34/pg-slowlog",
          bullets: [
            "Tails `pg_stat_statements` and surfaces regressions as a diff between two time windows.",
          ],
          tags: ["Go", "PostgreSQL"],
        },
      ],
    },

    {
      type: "grid",
      label: "Toolkit",
      groups: [
        { label: "Languages",  items: ["Go", "Rust", "Python", "TypeScript", "C++", "SQL"] },
        { label: "Systems",    items: ["Postgres", "Kafka", "Redis", "Kubernetes", "gRPC"] },
        { label: "Interests",  items: ["Storage engines", "Observability", "Compilers"] },
      ],
    },

    {
      type: "index",
      label: "Writing",
      items: [
        {
          title: "What I got wrong about cache invalidation",
          meta: "Apr 2025",
          url: "https://example.com/post",
        },
        {
          title: "A short defence of boring databases",
          meta: "Nov 2024",
          url: "https://example.com/post-2",
        },
      ],
    },

    {
      type: "index",
      label: "Education",
      items: [
        {
          title: "University of Somewhere",
          meta: "2017 — 2021",
          note: "B.S. Computer Science",
        },
      ],
    },

    {
      type: "prose",
      label: "Elsewhere",
      paragraphs: [
        "Outside of work I climb badly, cook ambitiously, and maintain a few small open-source tools. The best way to reach me is [email](mailto:you@example.com) — I answer everything that isn't a recruiter template.",
      ],
    },

  ],

  /* ---- footer ------------------------------------------------------------ */
  footer: "Built from a single JSON-ish file. [Source](https://github.com/vvinniev34/vvinniev34.github.io).",
};
