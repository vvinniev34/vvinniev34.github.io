/* ============================================================================
   terminal.js — a real prompt on the page.

   Every command reads from the same RESUME object in resume.js, so the
   terminal can never fall out of sync with the document below it. Add a job
   to resume.js and `ls experience` knows about it immediately.

   Set `terminal: false` in resume.js to remove it.
   ========================================================================== */

(function (root) {
  "use strict";

  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /* ---- the shell: pure logic, no DOM, so it can be tested -----------------
     `io` supplies the side effects (open a url, clear the screen, etc.).
     `run` returns an array of { t: text, c: cssClass } lines.
     ------------------------------------------------------------------------ */

  function createShell(R, io) {
    var out = [];
    function say(t, c) { out.push({ t: t, c: c || "out" }); }
    function dim(t) { say(t, "dim"); }
    function err(t) { say(t, "err"); }
    function blank() { say("", "out"); }

    var sections = (R.sections || []).map(function (s) {
      return { slug: slug(s.label), label: s.label, data: s };
    });

    function findSection(name) {
      var q = slug(name);
      return sections.filter(function (s) {
        return s.slug === q || s.slug.indexOf(q) === 0;
      })[0];
    }

    /* Two jobs at the same company would collide, so suffix repeats: acme-2. */
    function uniq(list) {
      var seen = {};
      return list.map(function (x) {
        var base = x.slug || "item";
        seen[base] = (seen[base] || 0) + 1;
        x.slug = seen[base] > 1 ? base + "-" + seen[base] : base;
        return x;
      });
    }

    function itemsOf(s) {
      var d = s.data;
      if (d.type === "entries") {
        return uniq((d.items || []).map(function (i) {
          return { slug: slug(i.org), name: i.org, item: i };
        }));
      }
      if (d.type === "index") {
        // Article titles are long; key them on the first few words so they
        // stay short enough to actually type.
        return uniq((d.items || []).map(function (i) {
          return {
            slug: slug(String(i.title || "").split(/\s+/).slice(0, 4).join(" ")),
            name: i.title,
            item: i,
          };
        }));
      }
      return [];
    }

    function pad(s, n) {
      s = String(s);
      if (s.length > n - 1) return s.slice(0, n - 2) + "… ";
      while (s.length < n) s += " ";
      return s;
    }

    /* strip the inline markdown that looks wrong in a terminal */
    function plain(s) {
      return String(s || "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
    }

    function printEntry(i) {
      say(i.org + (i.role ? "  —  " + i.role : ""), "accent");
      if (i.period) dim("   " + i.period);
      (i.bullets || []).forEach(function (b) { say("   · " + plain(b)); });
      if (i.tags && i.tags.length) dim("   [" + i.tags.join("  ") + "]");
      if (i.url) dim("   " + i.url);
    }

    /* ---- filesystem-ish state ------------------------------------------ */

    var cwd = null;                    // null = root, else a section slug

    function here() { return cwd ? findSection(cwd) : null; }

    function prompt() { return cwd ? "~/" + cwd : "~"; }

    function resolve(arg) {
      /* Accepts "experience", "experience/meta", "meta" when already inside
         experience, "..", "~", "/". Returns {sec, item} or null. */
      if (!arg || arg === "." ) return { sec: here(), item: null };
      if (arg === "~" || arg === "/") return { sec: null, item: null };
      if (arg === "..") return { sec: null, item: null };

      var parts = arg.split("/").filter(Boolean);
      var sec = null, rest = null;

      if (parts.length > 1) { sec = findSection(parts[0]); rest = parts[1]; }
      else if (cwd) {
        sec = here();
        rest = parts[0];
        // allow `cat experience` from inside another section
        var asSection = findSection(parts[0]);
        if (asSection && !itemsOf(sec).some(function (i) {
          return i.slug.indexOf(slug(parts[0])) === 0;
        })) { sec = asSection; rest = null; }
      } else { sec = findSection(parts[0]); rest = null; }

      if (!sec) return null;
      if (!rest) return { sec: sec, item: null };
      var hit = itemsOf(sec).filter(function (i) {
        return i.slug.indexOf(slug(rest)) === 0;
      })[0];
      return { sec: sec, item: hit || null, missing: !hit ? rest : null };
    }

    /* ---- searchable index ----------------------------------------------- */

    function haystack() {
      var rows = [];
      sections.forEach(function (sn) {
        var d = sn.data;
        (d.items || []).forEach(function (it, n) {
          var key = itemsOf(sn)[n];
          var path = sn.slug + "/" + (key ? key.slug : n);
          [it.org, it.role, it.title, it.note, it.period, it.meta]
            .filter(Boolean).forEach(function (txt) { rows.push({ path: path, text: txt }); });
          (it.bullets || []).forEach(function (bl) { rows.push({ path: path, text: bl }); });
          (it.tags || []).forEach(function (tg) { rows.push({ path: path, text: tg }); });
        });
        (d.groups || []).forEach(function (g) {
          rows.push({ path: sn.slug + "/" + slug(g.label), text: (g.items || []).join(", ") });
        });
        (d.paragraphs || []).forEach(function (pg) { rows.push({ path: sn.slug, text: pg }); });
      });
      (R.intro || []).forEach(function (pg) { rows.push({ path: "about", text: pg }); });
      return rows;
    }

    var CMDS = {

      help: function (arg) {
        if (arg) return CMDS.man(arg);
        say("commands — `man <name>` for detail on any of them", "accent");
        blank();
        [
          ["browsing", "ls  cd  cat  tree  pwd"],
          ["searching", "grep <term>"],
          ["me", "whoami  about  now  contact  links  open <name>"],
          ["the pond", "feed  koi"],
          ["session", "theme  resume  history  clear  help"],
        ].forEach(function (r) { say("  " + pad(r[0], 12) + r[1]); });
        blank();
        dim("tab completes · ↑ ↓ walk history · ctrl-l clears · !! repeats");
      },

      man: function (arg) {
        var docs = {
          ls: ["ls [path]", "List sections, or what's inside one.",
               "  ls              every section",
               "  ls experience   the roles in it"],
          cd: ["cd <section>", "Move into a section so ls and cat go relative.",
               "  cd experience   then: ls, cat meta",
               "  cd ..           back to the top"],
          cat: ["cat <path>", "Print a section, or one entry in it.",
                "  cat toolkit", "  cat experience/meta"],
          tree: ["tree", "The whole of resume.js at a glance."],
          grep: ["grep <term>", "Search every bullet, role, tag and paragraph.",
                 "  grep kafka", "  grep latency"],
          feed: ["feed [n]", "Scatter food on the pond. The koi will notice.",
                 "  feed            a normal handful",
                 "  feed 60         a generous one"],
          koi: ["koi [count|feed|splash]", "Poke at the pond behind this window."],
          open: ["open <name>", "Open a link in a new tab. See `links`."],
          theme: ["theme [dark|light]", "Switch the palette. The pond follows."],
          resume: ["resume", "Open the print dialog. The page reformats itself",
                   "into a one-page résumé from this same data."],
          whoami: ["whoami", "Name, role, location."],
          history: ["history", "What you've typed this session."],
        };
        var d = docs[slug(arg)] || docs[String(arg || "").toLowerCase()];
        if (!d) return err("no manual entry for " + arg);
        say(d[0], "accent");
        for (var i = 1; i < d.length; i++) say("  " + d[i]);
      },

      pwd: function () { say("  " + prompt()); },

      cd: function (arg) {
        if (!arg || arg === "~" || arg === "/") { cwd = null; return; }
        if (arg === "..") { cwd = null; return; }
        var sec = findSection(arg);
        if (!sec) return err("no such section: " + arg + "   (try `ls`)");
        cwd = sec.slug;
      },

      whoami: function () {
        say([R.name, R.role, R.location].filter(Boolean).join("  ·  "), "accent");
      },

      about: function () {
        (R.intro || []).forEach(function (p) { say(plain(p)); blank(); });
        if (R.now) dim(plain(R.now));
      },

      now: function () {
        if (R.now) say(plain(R.now), "accent"); else dim("nothing set");
      },

      contact: function () {
        var mail = (R.links || []).filter(function (l) {
          return /^mailto:/.test(l.url || "");
        })[0];
        if (mail) say("  " + mail.url.replace(/^mailto:/, ""), "accent");
        (R.links || []).forEach(function (l) {
          if (l.url && !/^mailto:/.test(l.url)) dim("  " + pad(slug(l.label), 12) + l.url);
        });
      },

      ls: function (arg) {
        var target = arg ? findSection(arg) : here();

        if (!target) {
          if (arg) return err("no such section: " + arg);
          sections.forEach(function (sn) {
            var n = itemsOf(sn).length;
            say("  " + pad(sn.slug, 16) + (n ? n + " item" + (n === 1 ? "" : "s") : sn.data.type));
          });
          return;
        }

        var items = itemsOf(target);
        if (!items.length) return dim("  (" + target.data.type + " — try `cat " + target.slug + "`)");
        items.forEach(function (i) {
          var sub = i.item.role || i.item.note || plain(i.name) || "";
          var when = i.item.period || i.item.meta || "";
          say("  " + pad(i.slug, 26) + pad(plain(sub), 32) + when);
        });
      },

      tree: function () {
        say(R.name || "me", "accent");
        sections.forEach(function (sn, si) {
          var last = si === sections.length - 1;
          say((last ? "└── " : "├── ") + sn.slug);
          var items = itemsOf(sn);
          var stem = last ? "    " : "│   ";
          if (!items.length && sn.data.type === "grid") {
            (sn.data.groups || []).forEach(function (g, gi, arr) {
              dim(stem + (gi === arr.length - 1 ? "└── " : "├── ") + slug(g.label));
            });
          }
          items.forEach(function (i, ii) {
            dim(stem + (ii === items.length - 1 ? "└── " : "├── ") + i.slug);
          });
        });
      },

      cat: function (arg) {
        if (!arg && !cwd) return err("usage: cat <section>[/<item>]");
        var r = resolve(arg || cwd);
        if (!r || !r.sec) return err("no such path: " + arg + "   (try `ls`)");
        if (r.missing) return err("no such entry: " + r.missing + "   (try `ls " + r.sec.slug + "`)");

        if (r.item) {
          if (r.sec.data.type === "entries") return printEntry(r.item.item);
          var it = r.item.item;
          say(plain(it.title), "accent");
          if (it.meta) dim("   " + it.meta);
          if (it.note) say("   " + plain(it.note));
          if (it.url) dim("   " + it.url);
          return;
        }

        var d = r.sec.data;
        if (d.type === "entries") {
          (d.items || []).forEach(function (i, n) { if (n) blank(); printEntry(i); });
        } else if (d.type === "index") {
          (d.items || []).forEach(function (i) {
            say("  " + pad(plain(i.title), 44) + (i.meta || ""));
            if (i.note) dim("    " + plain(i.note));
          });
        } else if (d.type === "grid") {
          (d.groups || []).forEach(function (g) {
            say("  " + pad(g.label, 14) + (g.items || []).join("  ·  "));
          });
        } else if (d.type === "prose") {
          (d.paragraphs || []).forEach(function (p) { say(plain(p)); });
        }
      },

      grep: function (arg) {
        if (!arg) return err("usage: grep <term>");
        var q = String(arg).toLowerCase();
        var hits = haystack().filter(function (row) {
          return plain(row.text).toLowerCase().indexOf(q) >= 0;
        });
        if (!hits.length) return dim("no matches for " + arg);
        hits.slice(0, 14).forEach(function (row) {
          var txt = plain(row.text);
          var at = txt.toLowerCase().indexOf(q);
          var from = Math.max(0, at - 28);
          var snip = (from ? "…" : "") + txt.slice(from, at + q.length + 44);
          if (at + q.length + 44 < txt.length) snip += "…";
          say(row.path, "accent");
          say("   " + snip);
        });
        blank();
        dim(hits.length + " match" + (hits.length === 1 ? "" : "es") +
            (hits.length > 14 ? " (showing 14)" : ""));
      },

      links: function () {
        (R.links || []).forEach(function (l) {
          say("  " + pad(slug(l.label), 12) + (l.url || "(prints the page)"));
        });
      },

      open: function (arg) {
        if (!arg) return err("usage: open <name>   (try `links`)");
        var q = slug(arg);
        var hit = (R.links || []).filter(function (l) {
          return l.url && slug(l.label).indexOf(q) === 0;
        })[0];

        if (!hit) {
          for (var i = 0; i < sections.length; i++) {
            var m = itemsOf(sections[i]).filter(function (it) {
              return it.item.url && it.slug.indexOf(q) === 0;
            })[0];
            if (m) { dim("opening " + m.item.url); io.open(m.item.url); return; }
          }
          return err("nothing to open called: " + arg);
        }
        dim("opening " + hit.url);
        io.open(hit.url);
      },

      feed: function (arg) {
        var n = parseInt(arg, 10);
        var dropped = io.pond("feed", isNaN(n) ? 18 : n);
        if (dropped == null) return dim("the pond isn't here right now");
        say("scattered " + dropped + " pellets on the water", "accent");
        dim("watch them come up for it");
      },

      koi: function (arg) {
        var sub = slug(arg) || "count";
        if (sub === "feed") return CMDS.feed("");
        if (sub === "splash") {
          if (io.pond("splash") == null) return dim("the pond isn't here right now");
          return dim("plop.");
        }
        var c = io.pond("count");
        if (c == null) return dim("the pond isn't here right now");
        say(c + " koi in the pond", "accent");
        var waiting = io.pond("pellets");
        if (waiting) dim(waiting + " pellets still floating");
      },

      theme: function (arg) {
        var t = io.setTheme(slug(arg) === "dark" || slug(arg) === "light" ? slug(arg) : null);
        dim("theme → " + t);
      },

      history: function () {
        var h = io.history();
        if (!h.length) return dim("nothing yet");
        h.slice().reverse().forEach(function (line, i) {
          say("  " + pad(String(i + 1), 5) + line);
        });
      },

      date: function () { say("  " + new Date().toString()); },

      echo: function (arg) { say("  " + plain(arg || "")); },

      uname: function () {
        say("  " + (R.name || "") + " — " + (R.role || "") +
            " — rendered from resume.js, no build step");
      },

      resume: function () { dim("opening print dialog…"); io.print(); },

      clear: function () { io.clear(); },

      /* ---- the fun ones --------------------------------------------------- */

      sudo: function () { err("nice try."); },
      vim: function () { dim("you are now trapped forever. (:q does nothing here)"); },
      emacs: function () { dim("we don't do that here."); },
      exit: function () { dim("there is no exit. the koi are watching."); },
      fortune: function () {
        var qs = [
          "There are only two hard things in computer science.",
          "It works on my machine.",
          "Premature optimisation is the root of all evil — but so is the other kind.",
          "The koi have no opinion on your architecture.",
          "Every system is a legacy system to someone.",
        ];
        dim("  " + qs[(Math.random() * qs.length) | 0]);
      },
    };

    CMDS.print = CMDS.resume;
    CMDS.man = CMDS.help;
    CMDS["?"] = CMDS.help;

    return {
      names: Object.keys(CMDS),
      sections: sections.map(function (s) { return s.slug; }),
      prompt: prompt,

      run: function (input) {
        out = [];
        var line = String(input || "").trim();
        if (!line) return out;

        var sp = line.indexOf(" ");
        var cmd = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
        var arg = sp < 0 ? "" : line.slice(sp + 1).trim();

        if (!CMDS[cmd]) {
          err("command not found: " + cmd);
          dim("type `help` to see what works");
          return out;
        }
        CMDS[cmd](arg);
        return out;
      },

      /* Tab completion. Knows the current directory, and falls back to the
         longest common prefix when several things match. */
      complete: function (input) {
        var line = String(input || "");
        var sp = line.indexOf(" ");

        function common(list) {
          if (!list.length) return null;
          if (list.length === 1) return list[0];
          var pre = list[0];
          list.forEach(function (x) {
            while (x.indexOf(pre) !== 0 && pre) pre = pre.slice(0, -1);
          });
          return pre || null;
        }

        if (sp < 0) {
          var m = Object.keys(CMDS).filter(function (c) { return c.indexOf(line) === 0; });
          if (!m.length) return { line: line };
          if (m.length === 1) return { line: m[0] + " " };
          return { line: common(m) || line, options: m };
        }

        var cmd = line.slice(0, sp).toLowerCase();
        var rest = line.slice(sp + 1);
        if (["ls", "cat", "cd", "tree", "open", "man", "help"].indexOf(cmd) < 0) return { line: line };

        if (cmd === "man" || cmd === "help") {
          var mm = Object.keys(CMDS).filter(function (c) { return c.indexOf(slug(rest)) === 0; });
          if (mm.length === 1) return { line: cmd + " " + mm[0] };
          return { line: mm.length ? cmd + " " + (common(mm) || rest) : line, options: mm };
        }

        if (cmd === "open") {
          var names = (R.links || []).filter(function (l) { return l.url; })
                                     .map(function (l) { return slug(l.label); });
          var oh = names.filter(function (n) { return n.indexOf(slug(rest)) === 0; });
          if (oh.length === 1) return { line: "open " + oh[0] };
          return { line: oh.length ? "open " + (common(oh) || rest) : line, options: oh };
        }

        var seg = rest.split("/");

        // inside a section, bare names complete against its entries first
        if (seg.length === 1 && cwd && cmd !== "cd") {
          var local = itemsOf(here()).map(function (i) { return i.slug; })
                        .filter(function (n) { return n.indexOf(slug(seg[0])) === 0; });
          if (local.length === 1) return { line: cmd + " " + local[0] };
          if (local.length > 1) return { line: cmd + " " + (common(local) || seg[0]), options: local };
        }

        if (seg.length === 1) {
          var sh = sections.map(function (x) { return x.slug; })
                     .filter(function (n) { return n.indexOf(slug(seg[0])) === 0; });
          if (sh.length === 1) return { line: cmd + " " + sh[0] + (cmd === "cd" ? "" : "/") };
          return { line: sh.length ? cmd + " " + (common(sh) || seg[0]) : line, options: sh };
        }

        var sec = findSection(seg[0]);
        if (!sec) return { line: line };
        var ih = itemsOf(sec).map(function (i) { return i.slug; })
                   .filter(function (n) { return n.indexOf(slug(seg[1])) === 0; });
        if (ih.length === 1) return { line: cmd + " " + sec.slug + "/" + ih[0] };
        return { line: ih.length ? cmd + " " + sec.slug + "/" + (common(ih) || seg[1]) : line,
                 options: ih };
      },
    };
  }

  root.createShell = createShell;

  /* ---- mount ------------------------------------------------------------- */

  if (typeof document === "undefined") return;           // running under a test
  var R = typeof RESUME !== "undefined" ? RESUME : null;
  if (!R || R.terminal === false) return;

  var host = document.getElementById("termcol");
  if (!host) return;

  function n(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var wrap  = n("div", "term");
  var bar   = n("div", "term__bar");
  bar.appendChild(n("span", "term__dots"));
  bar.appendChild(n("span", "term__title", (slug(R.name) || "me") + " — zsh"));
  var body  = n("div", "term__body");
  var form  = document.createElement("form");
  form.className = "term__line";
  var ps1   = n("span", "term__ps1", "~ ❯");
  function syncPrompt() { ps1.textContent = shell.prompt() + " ❯"; }
  var input = document.createElement("input");
  input.className = "term__input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Terminal input. Type help for commands.");
  input.placeholder = "type `help`";

  form.appendChild(ps1);
  form.appendChild(input);
  wrap.appendChild(bar);
  wrap.appendChild(body);
  wrap.appendChild(form);
  host.appendChild(wrap);

  var history = [];
  var hpos = -1;

  var shell = createShell(R, {
    open: function (u) { window.open(u, "_blank", "noopener"); },
    history: function () { return history; },
    pond: function (op, n) {
      if (!window.pond) return null;
      if (op === "feed") return window.pond.feed(n);
      if (op === "count") return window.pond.count();
      if (op === "pellets") return window.pond.pellets();
      if (op === "splash") { window.pond.splash(); return true; }
      return null;
    },
    clear: function () { body.innerHTML = ""; },
    print: function () { setTimeout(function () { window.print(); }, 150); },
    setTheme: function (force) {
      var t = force || (document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("theme", t); } catch (e) {}
      return t;
    },
  });

  function write(lines) {
    lines.forEach(function (l) {
      body.appendChild(n("div", "term__row term__row--" + l.c, l.t || " "));
    });
    body.scrollTop = body.scrollHeight;
  }

  function echo(cmd) {
    var row = n("div", "term__row term__row--cmd");
    row.appendChild(n("span", "term__ps1", shell.prompt() + " ❯"));
    row.appendChild(n("span", null, " " + cmd));
    body.appendChild(row);
  }

  function submit(cmd) {
    // `!!` re-runs the previous command, as it would in a real shell.
    if (cmd.trim() === "!!") cmd = history[0] || "";
    echo(cmd);
    if (cmd.trim()) history.unshift(cmd);
    hpos = -1;
    write(shell.run(cmd));
    syncPrompt();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = "";
    submit(v);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var c = shell.complete(input.value);
      input.value = c.line;
      // Several candidates: show them, the way a shell does on a second tab.
      if (c.options && c.options.length > 1) {
        write(c.options.map(function (o, i) {
          return { t: (i ? "" : "  ") + o, c: "dim" };
        }));
      }
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      echo(input.value + "^C");
      input.value = "";
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hpos < history.length - 1) input.value = history[++hpos];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      input.value = hpos > 0 ? history[--hpos] : (hpos = -1, "");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      body.innerHTML = "";
    }
  });

  // Clicking anywhere in the terminal focuses the prompt, like a real one.
  wrap.addEventListener("click", function (e) {
    if (window.getSelection && String(window.getSelection())) return;  // let people copy
    input.focus();
  });

  /* Boot: run whoami so the box is never empty, and the affordance is obvious. */
  write([{ t: (R.pageTitle || R.name) + " — type `help` for commands", c: "dim" }]);
  submit("whoami");
  syncPrompt();
})(this);
