// This empty relay receives only displayable project HTML from its embedding
// deck. It has no board identity, capability, provider key, or server API.
// The response-header sandbox/CSP remains in force after document.write.
export const PROJECT_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-forms";
export const PROJECT_PREVIEW_SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Heart of Gold project preview</title></head>
<body><script>
(() => {
  if (window.parent === window) return;
  let accepted = false;
  window.addEventListener('message', event => {
    if (accepted || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'hog:render-project' || typeof data.nonce !== 'string' || data.nonce.length > 160 || typeof data.html !== 'string' || data.html.length > 900000) return;
    accepted = true;
    document.open(); document.write(data.html); document.close();
  });
  window.parent.postMessage({ type: 'hog:preview-ready' }, '*');
})();
</script></body></html>`;
