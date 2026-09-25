/* ============================================================================
   site.js — turns the RESUME object in resume.js into the page.
   You should not need to edit this file to change your content.
   ========================================================================== */

(function () {
  "use strict";

  var R = typeof RESUME !== "undefined" ? RESUME : null;
  var root = document.getElementById("root");

  if (!R) {
    root.innerHTML = "<p>Couldn't find <code>resume.js</code>. Is it next to index.html?</p>";
    return;
  }

  /* ---- tiny dom helper ---------------------------------------------------- */

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    for (var k in props || {}) {
      if (k === "class") n.className = props[k];
      else if (k === "html") n.innerHTML = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (props[k] != null) n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---- inline markdown: **bold** *em* `code` [text](url) ------------------ */

  function inline(s) {
    if (s == null) return "";
    var code = [];
    // Pull code spans out first so their contents aren't parsed further.
    var out = String(s).replace(/`([^`]+)`/g, function (_, c) {
      return "\u0000" + (code.push(c) - 1) + "\u0000";
    });

    out = out
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, href) {
        var ext = /^https?:/.test(href);
        return '<a href="' + href + '"' +
               (ext ? ' target="_blank" rel="noopener noreferrer"' : "") +
               ">" + text + "</a>";
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

    return out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return "<code>" + code[i].replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</code>";
    });
  }

  function leader(cls) { return el("span", { class: cls, "aria-hidden": "true" }); }

  /* ---- document head ------------------------------------------------------ */

  document.title = R.pageTitle || [R.name, R.role].filter(Boolean).join(" — ");

  if (R.accent) document.documentElement.style.setProperty("--accent", R.accent);

  function meta(attr, name, content) {
    if (!content) return;
    var m = el("meta", {}); m.setAttribute(attr, name); m.content = content;
    document.head.appendChild(m);
  }
  meta("name", "description", R.description);
  meta("name", "theme-color", R.accent);
  meta("property", "og:title", document.title);
  meta("property", "og:description", R.description);
  meta("property", "og:type", "profile");

  // Favicon: accent square with your initials, generated on the fly.
  (function favicon() {
    var initials = (R.name || "")
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0]; }).join("").toUpperCase();
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="12" fill="' + (R.accent || "#b4451f") + '"/>' +
      '<text x="32" y="43" font-family="monospace" font-size="30" font-weight="600" ' +
      'fill="#fff" text-anchor="middle">' + initials + "</text></svg>";
    document.head.appendChild(el("link", {
      rel: "icon",
      href: "data:image/svg+xml," + encodeURIComponent(svg),
    }));
  })();

  /* ---- masthead ----------------------------------------------------------- */

  function masthead() {
    // First word on line one, the rest indented below it.
    var parts = String(R.name || "").split(/\s+/).filter(Boolean);
    var name = el("h1", { class: "masthead__name" }, [
      document.createTextNode(parts[0] || ""),
    ]);
    if (parts.length > 1) {
      name.appendChild(el("span", { class: "ln2", text: parts.slice(1).join(" ") }));
    }

    var kids = [name];

    var bits = [R.role, R.location].filter(Boolean);
    if (bits.length) {
      kids.push(el("p", {
        class: "masthead__role",
        html: bits.map(function (b) { return inline(b); })
                  .join('<span class="sep">/</span>'),
      }));
    }

    kids.push(el("div", { class: "masthead__rule", "aria-hidden": "true" }));

    if (R.intro && R.intro.length) {
      kids.push(el("div", { class: "intro" }, R.intro.map(function (p) {
        return el("p", { html: inline(p) });
      })));
    }

    if (R.now || R.githubUser) {
      kids.push(el("p", { class: "now" }, [
        el("span", { class: "now__dot", "aria-hidden": "true" }),
        el("span", { class: "now__text", html: inline(R.now || "") }),
        el("span", { class: "now__live", id: "now-live" }),
      ]));
    }

    if (R.links && R.links.length) {
      kids.push(el("ul", { class: "linkrow" }, R.links.map(function (l) {
        var node;
        if (l.action === "print") {
          node = el("button", { type: "button", text: l.label });
          node.addEventListener("click", function () { window.print(); });
        } else {
          var ext = /^https?:/.test(l.url || "");
          node = el("a", {
            href: l.url,
            text: l.label,
            target: ext ? "_blank" : null,
            rel: ext ? "noopener noreferrer" : null,
          });
        }
        return el("li", {}, [node]);
      })));
    }

    return el("header", { class: "masthead" }, kids);
  }

  /* ---- section renderers -------------------------------------------------- */

  var render = {

    prose: function (s) {
      return el("div", { class: "prose" }, (s.paragraphs || []).map(function (p) {
        return el("p", { html: inline(p) });
      }));
    },

    entries: function (s) {
      return el("div", { class: "stagger" }, (s.items || []).map(function (it) {
        var org = it.url
          ? el("a", {
              href: it.url,
              text: it.org,
              target: "_blank",
              rel: "noopener noreferrer",
            })
          : document.createTextNode(it.org || "");

        var top = el("div", { class: "entry__top" }, [
          el("h3", { class: "entry__org" }, [org]),
          it.period ? leader("entry__leader") : null,
          it.period ? el("span", { class: "entry__period", text: it.period }) : null,
        ]);

        return el("article", { class: "entry" }, [
          top,
          it.role ? el("p", { class: "entry__role", html: inline(it.role) }) : null,
          it.bullets && it.bullets.length
            ? el("ul", { class: "entry__bullets" }, it.bullets.map(function (b) {
                return el("li", { html: inline(b) });
              }))
            : null,
          it.tags && it.tags.length
            ? el("ul", { class: "tags" }, it.tags.map(function (t) {
                return el("li", { text: t });
              }))
            : null,
        ]);
      }));
    },

    index: function (s) {
      return el("ul", { class: "index stagger" }, (s.items || []).map(function (it) {
        var inner = [
          el("span", { class: "index__title", html: inline(it.title) }),
          it.meta ? leader("index__leader") : null,
          it.meta ? el("span", { class: "index__meta", text: it.meta }) : null,
        ];

        var row = it.url
          ? el("a", {
              class: "index__row",
              href: it.url,
              target: /^https?:/.test(it.url) ? "_blank" : null,
              rel: /^https?:/.test(it.url) ? "noopener noreferrer" : null,
            }, inner)
          : el("div", { class: "index__row" }, inner);

        return el("li", {}, [
          row,
          it.note ? el("p", { class: "index__note", html: inline(it.note) }) : null,
        ]);
      }));
    },

    grid: function (s) {
      return el("div", { class: "grid stagger" }, (s.groups || []).map(function (g) {
        return el("div", { class: "grid__row" }, [
          el("div", { class: "grid__label", text: g.label }),
          el("div", { class: "grid__items" }, (g.items || []).map(function (i) {
            return el("span", { text: i });
          })),
        ]);
      }));
    },
  };

  function section(s, n) {
    var body = render[s.type];
    if (!body) {
      console.warn('resume.js: unknown section type "' + s.type + '" — skipped.');
      return null;
    }

    var content = body(s);

    // Stagger children in on scroll rather than revealing the block at once.
    if ((content.className || "").indexOf("stagger") >= 0) {
      Array.prototype.forEach.call(content.children, function (c, i) {
        c.style.setProperty("--i", i);
      });
    }

    return el("section", { class: "section reveal" }, [
      el("div", { class: "section__head" }, [
        el("span", {
          class: "section__num",
          "aria-hidden": "true",
          text: ("0" + n).slice(-2),
        }),
        el("h2", { class: "section__label", text: s.label || "" }),
      ]),
      content,
    ]);
  }

  /* ---- build -------------------------------------------------------------- */

  root.appendChild(masthead());
  var n = 0;
  (R.sections || []).forEach(function (s) {
    var node = section(s, n + 1);
    if (node) { root.appendChild(node); n++; }
  });
  if (R.footer) {
    root.appendChild(el("footer", { class: "footer reveal", html: inline(R.footer) }));
  }

  /* ---- theme toggle ------------------------------------------------------- */

  document.getElementById("theme").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
  });

  /* ---- sticky top bar ----------------------------------------------------- */

  var topbar = document.getElementById("topbar");
  document.getElementById("topbar-name").textContent = R.name || "";

  var sentinel = document.querySelector(".masthead__name");
  if (sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      topbar.classList.toggle("is-visible", !entries[0].isIntersecting);
      topbar.setAttribute("aria-hidden", entries[0].isIntersecting ? "true" : "false");
    }, { rootMargin: "-8px 0px 0px 0px" }).observe(sentinel);
  }

  /* ---- scroll reveal ------------------------------------------------------ */

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = document.querySelectorAll(".reveal");

  if (reduced || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(reveals, function (n) { n.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    Array.prototype.forEach.call(reveals, function (n) { io.observe(n); });
  }

  // Everything is visible when printing, regardless of scroll position.
  window.addEventListener("beforeprint", function () {
    Array.prototype.forEach.call(reveals, function (n) { n.classList.add("is-in"); });
  });

  /* ---- live: your most recent public push ---------------------------------
     Reads the public GitHub events API — no token, no build step. If it's
     rate-limited or offline it simply renders nothing. Delete `githubUser`
     from resume.js to turn this off.
     ------------------------------------------------------------------------ */

  function ago(iso) {
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + "d ago";
    return Math.floor(days / 30) + "mo ago";
  }

  (function liveActivity() {
    var slot = document.getElementById("now-live");
    if (!slot || !R.githubUser || typeof fetch !== "function") return;

    fetch("https://api.github.com/users/" +
          encodeURIComponent(R.githubUser) + "/events/public")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (events) {
        if (!Array.isArray(events)) return;
        var push = events.filter(function (e) { return e.type === "PushEvent"; })[0];
        if (!push || !push.repo) return;

        var full = push.repo.name;                   // "owner/repo"
        var link = el("a", {
          href: "https://github.com/" + full,
          text: full.split("/").pop(),
          target: "_blank",
          rel: "noopener noreferrer",
        });

        slot.appendChild(document.createTextNode("· last push to "));
        slot.appendChild(link);
        slot.appendChild(document.createTextNode(" " + ago(push.created_at)));
      })
      .catch(function () { /* offline or rate-limited — stay quiet */ });
  })();
})();
