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

    var CMDS = {

      help: function () {
        say("available commands", "accent");
        [
          ["whoami", "name, role, location"],
          ["about", "the intro paragraphs"],
          ["ls", "list sections"],
          ["ls <section>", "list what's in one"],
          ["cat <section>", "print a whole section"],
          ["cat <section>/<item>", "print one entry"],
          ["links", "every link on the page"],
          ["open <name>", "open a link (github, linkedin, …)"],
          ["resume", "print this page as a PDF résumé"],
          ["theme", "toggle light / dark"],
          ["clear", "wipe the screen"],
        ].forEach(function (r) { say("  " + pad(r[0], 22) + r[1]); });
        blank();
        dim("tab completes · ↑ ↓ walk history");
      },

      whoami: function () {
        say([R.name, R.role, R.location].filter(Boolean).join("  ·  "), "accent");
      },

      about: function () {
        (R.intro || []).forEach(function (p) { say(plain(p)); blank(); });
        if (R.now) dim(plain(R.now));
      },

      ls: function (arg) {
        if (!arg) {
          sections.forEach(function (s) {
            var n = itemsOf(s).length;
            say("  " + pad(s.slug, 16) + (n ? n + " item" + (n === 1 ? "" : "s") : s.data.type));
          });
          return;
        }
        var s = findSection(arg);
        if (!s) return err("no such section: " + arg + "   (try `ls`)");
        var items = itemsOf(s);
        if (!items.length) return dim("  (" + s.data.type + " section — try `cat " + s.slug + "`)");
        items.forEach(function (i) {
          var sub = i.item.role || i.item.note || plain(i.name) || "";
          var when = i.item.period || i.item.meta || "";
          say("  " + pad(i.slug, 26) + pad(plain(sub), 32) + when);
        });
      },

      cat: function (arg) {
        if (!arg) return err("usage: cat <section>[/<item>]");
        var parts = arg.split("/");
        var s = findSection(parts[0]);
        if (!s) return err("no such section: " + parts[0] + "   (try `ls`)");

        if (parts[1]) {
          var q = slug(parts[1]);
          var hit = itemsOf(s).filter(function (i) { return i.slug.indexOf(q) === 0; })[0];
          if (!hit) return err("no such entry: " + parts[1] + "   (try `ls " + s.slug + "`)");
          if (s.data.type === "entries") return printEntry(hit.item);
          say(plain(hit.item.title), "accent");
          if (hit.item.meta) dim("   " + hit.item.meta);
          if (hit.item.note) say("   " + plain(hit.item.note));
          if (hit.item.url) dim("   " + hit.item.url);
          return;
        }

        var d = s.data;
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
          // fall back to any entry with a url — `open littlefs-viz`
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

      theme: function (arg) {
        var t = io.setTheme(slug(arg) === "dark" || slug(arg) === "light" ? slug(arg) : null);
        dim("theme → " + t);
      },

      resume: function () { dim("opening print dialog…"); io.print(); },

      clear: function () { io.clear(); },

      sudo: function () { err("nice try."); },

      vim: function () { dim("you are now trapped forever. (:q does nothing here)"); },

      exit: function () { dim("there is no exit. scroll instead ↓"); },
    };

    CMDS.print = CMDS.resume;
    CMDS.man = CMDS.help;
    CMDS["?"] = CMDS.help;

    return {
      names: Object.keys(CMDS),
      sections: sections.map(function (s) { return s.slug; }),

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

      /* tab completion: command names, then section names for ls / cat */
      complete: function (input) {
        var line = String(input || "");
        var sp = line.indexOf(" ");

        if (sp < 0) {
          var m = Object.keys(CMDS).filter(function (c) { return c.indexOf(line) === 0; });
          return m.length === 1 ? m[0] + " " : line;
        }

        var cmd = line.slice(0, sp).toLowerCase();
        if (cmd !== "ls" && cmd !== "cat") return line;

        var rest = line.slice(sp + 1);
        var seg = rest.split("/");
        if (seg.length === 1) {
          var hits = sections.filter(function (s) { return s.slug.indexOf(slug(seg[0])) === 0; });
          return hits.length === 1 ? cmd + " " + hits[0].slug : line;
        }
        var sec = findSection(seg[0]);
        if (!sec) return line;
        var ih = itemsOf(sec).filter(function (i) { return i.slug.indexOf(slug(seg[1])) === 0; });
        return ih.length === 1 ? cmd + " " + sec.slug + "/" + ih[0].slug : line;
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

  var shell = createShell(R, {
    open: function (u) { window.open(u, "_blank", "noopener"); },
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
    row.appendChild(n("span", "term__ps1", "~ ❯"));
    row.appendChild(n("span", null, " " + cmd));
    body.appendChild(row);
  }

  var history = [];
  var hpos = -1;

  function submit(cmd) {
    echo(cmd);
    if (cmd.trim()) history.unshift(cmd);
    hpos = -1;
    write(shell.run(cmd));
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
      input.value = shell.complete(input.value);
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
})(this);
