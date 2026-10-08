# site/

Static files for wehatemail.com. No build step, no server code.

- `join/` is the page behind `https://wehatemail.com/join#<invite>`. It tries to open
  `wehatemail://join/<invite>`, and if the app is not installed it shows download
  buttons for the visitor's OS. The invite stays after the `#`, so browsers never send it.
- Publish the folder as-is (GitHub Pages: set the source to this folder or copy it into
  the Pages branch). `join/index.html` must be reachable at `/join` (and `/join/`).
- Try it locally: `npx serve site` then open `http://localhost:3000/join/#cfo3e5jpcfo3e5jp`.
