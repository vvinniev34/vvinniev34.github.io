# Personal site

One screen, no scrolling. Your name and intro on the left, a terminal you can
actually type into on the right, a koi pond behind both.

Everything comes from **one source of truth**: [`resume.js`](resume.js). The
left column, every terminal command, and the printable résumé all read the same
object, so they cannot drift apart.

No build step. No `npm install`. No dependencies.

## Updating it

1. Open `resume.js`.
2. Change something.
3. Save, and refresh the browser.

Double-click `index.html` to preview locally, or run `python3 -m http.server`
in this folder and open <http://localhost:8000>.

Text fields accept a little inline markdown:

```
**bold**    *italic*    `code`    [link text](https://example.com)
```

## Where your content shows up

The page itself only shows your name, role, intro, "currently" line, and links.
Everything else — experience, projects, writing, education — lives in the
`sections` array and is reachable two ways:

- **In the terminal.** `ls`, `ls experience`, `cat experience/meta`, `cat toolkit`.
- **In print.** ⌘P lays the full document out as a clean one-page résumé.

So adding a job to `resume.js` updates the terminal and your résumé at once.

### Adding a section

Add an object to the `sections` array. Four types:

| type        | use it for                | shape                                                |
| ----------- | ------------------------- | ---------------------------------------------------- |
| `"entries"` | jobs, projects            | `items: [{ org, role, period, url, bullets, tags }]` |
| `"index"`   | writing, talks, education | `items: [{ title, meta, url, note }]`                |
| `"grid"`    | skills, tools             | `groups: [{ label, items: [] }]`                     |
| `"prose"`   | anything in paragraphs    | `paragraphs: []`                                     |

Every field is optional — leave one out and it doesn't render.

## The terminal

```
help                    everything below
whoami / about          who you are
ls                      list sections
ls experience           list what's in one
cat experience/meta     print one entry
cat toolkit             print a whole section
links / open github     your links
resume                  print dialog
theme                   toggle light / dark
clear                   wipe the screen
```

Tab completes, ↑/↓ walks history, ctrl-L clears. Section and entry names are
slugs derived from your own data, so they stay correct automatically.

## The pond

Fixed to the viewport, so it stays put while narrow screens scroll. The koi
wander, flee your cursor within 240px, and scatter when you click the water
(clicks on links, buttons and the terminal are ignored). Colours come from CSS
variables, so it restyles with the theme toggle.

Tune it at the top of `style.css`: `--pond`, `--pond-deep`, `--pond-light`,
`--koi-cream`, `--koi-dark`.

## Responsive

Above 62rem it's a fixed two-column screen with no page scroll. Below that the
columns stack, the page scrolls normally, and the terminal takes a capped
height so the intro isn't pushed off the top.

Under `prefers-reduced-motion` the pond renders one static frame instead of
animating — clicking still splashes.

## Turning things off

In `resume.js`:

```js
heroCanvas: false,   // remove the pond
terminal:   false,   // remove the prompt
```

## Files

```
index.html   layout shell — rarely needs touching
resume.js    ← your content lives here
site.js      renders resume.js into the left column and the print document
terminal.js  the prompt (command layer is DOM-free and unit-testable)
canvas.js    the koi pond
style.css    the design
```

## Deploying

The repo is `vvinniev34.github.io`, so GitHub Pages serves it at
<https://vvinniev34.github.io> from `main` with no configuration.

```bash
git commit -am "Update" && git push
```

For a custom domain, add a `CNAME` file containing just the domain and point a
DNS `ALIAS`/`A` record at GitHub Pages.
