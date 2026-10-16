import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
import path from 'path';

// Vite loads ESM configs natively; `import.meta.dirname` keeps working there.
const rootDir = import.meta.dirname;

/**
 * Plugin to inline the favicon as a data URI so the exported HTML is fully
 * standalone. Optional: no favicon ships today, and the app builds without one.
 */
function inlineFavicon(): Plugin {
  return {
    name: 'inline-favicon',
    transformIndexHtml(html) {
      const faviconPath = path.resolve(rootDir, 'public/favicon.svg');
      if (fs.existsSync(faviconPath)) {
        const svg = fs.readFileSync(faviconPath, 'utf-8');
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        return html.replace(
          /<link rel="icon"[^>]*\/>/,
          `<link rel="icon" type="image/svg+xml" href="${dataUri}" />`
        );
      }
      return html;
    },
  };
}

/**
 * Plugin to post-process the final HTML (ported from PowerScroll's
 * vite.export.config.ts):
 * 1. Remove crossorigin attributes that mean nothing for inlined scripts
 * 2. Move the main app script from <head> to just before </body> so the DOM
 *    exists when it runs
 * 3. Rename index.html to PowerBoard.html — the one file the app ships as
 *
 * REQ-PB-110: the result makes no external requests, so it opens offline.
 */
function fixForStandalone(): Plugin {
  return {
    name: 'fix-for-standalone',
    enforce: 'post',
    closeBundle() {
      const outDir = path.resolve(rootDir, 'dist-app');
      const indexPath = path.join(outDir, 'index.html');
      if (!fs.existsSync(indexPath)) return;

      let html = fs.readFileSync(indexPath, 'utf-8');

      // Remove crossorigin attribute (not needed for inlined scripts)
      html = html.replace(/ crossorigin/g, '');

      // Find the main app script tag
      const scriptOpen = '<script type="module">';
      const scriptStart = html.indexOf(scriptOpen);
      const scriptTagEnd = scriptStart + scriptOpen.length;
      // The real </script> is at the very end of the file (last occurrence)
      const scriptCloseStart = html.lastIndexOf('</script>');
      const scriptEnd = scriptCloseStart + '</script>'.length;

      if (scriptStart >= 0 && scriptCloseStart > scriptStart) {
        // Extract the JS content between the script tags
        let jsContent = html.substring(scriptTagEnd, scriptCloseStart);

        // CRITICAL: Escape </script and <script inside the JS bundle.
        // The minified JS contains literal HTML strings (from marked library,
        // serialization code, etc.) that the browser's HTML parser would
        // interpret as actual tags, breaking the script.
        jsContent = jsContent.replace(/<\/script/gi, '<\\/script');
        jsContent = jsContent.replace(/<script/gi, '\\x3cscript');

        const appScript = `<script type="module">${jsContent}</script>`;
        const before = html.substring(0, scriptStart);
        const after = html.substring(scriptEnd);

        // Move script to before </body>
        const lastBodyClose = after.lastIndexOf('</body>');
        if (lastBodyClose >= 0) {
          html =
            before +
            after.substring(0, lastBodyClose) +
            appScript +
            '\n' +
            after.substring(lastBodyClose);
        } else {
          html = before + appScript + after;
        }
      }

      fs.writeFileSync(path.join(outDir, 'PowerBoard.html'), html, 'utf-8');
      fs.rmSync(indexPath, { force: true });
    },
  };
}

/**
 * Build config for the standalone app: one self-contained PowerBoard.html
 * with all JS/CSS/assets inlined (REQ-PB-110).
 */
export default defineConfig({
  // The app lives in src/app, so its index.html is the build's entry point.
  root: path.resolve(rootDir, 'src/app'),
  plugins: [react(), viteSingleFile(), inlineFavicon(), fixForStandalone()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(rootDir, 'dist-app'),
    emptyOutDir: true,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(rootDir, 'src/app/index.html'),
      output: {
        manualChunks: undefined,
      },
    },
  },
});
