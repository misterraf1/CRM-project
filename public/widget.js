/* Axis website chat loader. Usage:
   <script src="https://app.example/widget.js" data-axis-widget="KEY" async></script>
   Renders a floating button that opens the chat in an iframe served from our origin,
   so the host page never sees conversation data or our cookies. */
(function () {
  var script = document.currentScript;
  var key = script && script.getAttribute("data-axis-widget");
  if (!key || window.__axisWidget) return;
  window.__axisWidget = true;
  var origin = new URL(script.src).origin;

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Chat");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:#2563eb;color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);z-index:2147483646;display:grid;place-items:center";

  var frame = document.createElement("iframe");
  frame.src = origin + "/widget/" + encodeURIComponent(key);
  frame.title = "Chat";
  frame.style.cssText =
    "position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483647;display:none;background:#fff";

  button.addEventListener("click", function () {
    var open = frame.style.display === "none";
    frame.style.display = open ? "block" : "none";
    button.setAttribute("aria-expanded", String(open));
  });

  document.body.appendChild(frame);
  document.body.appendChild(button);
})();
