# Personal site

A static personal site with **one source of truth**: [`resume.js`](resume.js).
Everything on the page — the intro, jobs, projects, skills, writing, footer —
is rendered from the object in that file.

No build step. No `npm install`. No dependencies.

## Updating it

1. Open `resume.js`.
2. Change something.
3. Save, and refresh the browser.

That's the whole workflow. Double-click `index.html` to preview locally, or run
`python3 -m http.server` in this folder and open <http://localhost:8000>.

### What you can write

Text fields accept a little inline markdown:

```
**bold**    *italic*    `code`    [link text](https://example.com)
```

### Adding a section

Add an object to the `sections` array. Order in the array is order on the page.
There are four types:

| type        | use it for                    | shape                                        |
| ----------- | ----------------------------- | -------------------------------------------- |
| `"entries"` | jobs, projects                | `items: [{ org, role, period, url, bullets, tags }]` |
| `"index"`   | writing, talks, education     | `items: [{ title, meta, url, note }]`        |
| `"grid"`    | skills, tools                 | `groups: [{ label, items: [] }]`             |
| `"prose"`   | anything in paragraphs        | `paragraphs: []`                             |

Every field is optional — leave one out and it just doesn't render.

## Other things it does

- **Dark mode** — follows your OS, with a toggle in the top right that sticks.
- **Résumé PDF** — the "Résumé" link runs `window.print()`, and the print
  stylesheet reformats the page into a clean one-page résumé. Your site and your
  résumé can never drift apart, because they're the same file.
- **Accent colour** — one value, `accent`, at the top of `resume.js`.

## Files

```
index.html   markup shell — rarely needs touching
resume.js    ← your content lives here
site.js      renders resume.js into the page
style.css    the design
```

## Deploying to GitHub Pages

Name the repo `vvinniev34.github.io` and it will be served at that URL
from the default branch, no configuration needed.

```bash
# with the GitHub CLI (brew install gh && gh auth login):
gh repo create vvinniev34.github.io --public --source=. --remote=origin --push

# without it: create an empty repo of that name on github.com, then
git remote add origin git@github.com:vvinniev34/vvinniev34.github.io.git
git push -u origin main
```

Pushing to `main` republishes the site. To use a custom domain later, add a
`CNAME` file containing just the domain, and point a DNS `ALIAS`/`A` record at
GitHub Pages.
