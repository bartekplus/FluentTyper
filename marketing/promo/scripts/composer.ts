/** The v2 promo's synthetic mail window: fills a 1200×640 viewport, synthetic text only. */
export const COMPOSER_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>New message</title><style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fff;color:#1d1d1f;font:16px/1.5 system-ui,sans-serif;display:flex;flex-direction:column}
.top{height:64px;padding:0 32px;border-bottom:1px solid #e5e5ea;display:flex;align-items:center;justify-content:space-between;font-weight:650;font-size:18px}
.top span{color:#86868b;font-weight:500;font-size:15px}
.meta{padding:14px 32px;border-bottom:1px solid #e5e5ea;font-size:16px;color:#6e6e73;display:grid;gap:6px}
.meta b{color:#1d1d1f;font-weight:600;display:inline-block;width:76px}
#doc{flex:1;font:34px/1.5 system-ui,sans-serif;padding:28px 32px;outline:none;white-space:pre-wrap;letter-spacing:-0.01em}
</style><body><div class="top">New message <span>Draft</span></div><div class="meta"><div><b>To</b>Design team</div><div><b>Subject</b>Quick update</div></div><div id="doc" contenteditable="true" spellcheck="false"></div></body></html>`;
