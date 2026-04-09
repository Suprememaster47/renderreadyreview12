document.addEventListener('DOMContentLoaded', () => {
  const widget = document.getElementById('chat-widget');
  const header = document.getElementById('chat-header');
  const messages = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  if (!widget || !header || !messages || !input || !sendBtn) return;

  // --- SWIPE & CLICK LOGIC ---
  let touchStartY = 0;

  header.addEventListener('click', () => {
    widget.classList.toggle('minimized');
  });

  widget.addEventListener('touchstart', (e) => {
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  widget.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].screenY;
    const distance = touchEndY - touchStartY;
    const isMinimized = widget.classList.contains('minimized');

    // Swipe Down (Distance > 0)
    if (distance > 60 && !isMinimized) {
      widget.classList.add('minimized');
    } 
    // Swipe Up (Distance < 0)
    else if (distance < -60 && isMinimized) {
      widget.classList.remove('minimized');
    }
  }, { passive: true });

  // --- CLIENT-SIDE RATE LIMITING ---
  const RATE_LIMIT_MS = 3000; // 3 seconds between messages
  let lastSentTime = 0;

  // --- WEBSOCKET & 3-DOT LOGIC ---
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  const sessionId = localStorage.getItem("chat_session_id") || `s_${Date.now().toString(36)}`;
  localStorage.setItem("chat_session_id", sessionId);

  function addBubble(text, who, options = {}) {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    
    if (who === "bot" && options.isTyping) {
      const t = document.createElement("div");
      t.className = "typing";
      t.innerHTML = '<span></span><span></span><span></span>';
      div.appendChild(t);
    } else {
      div.textContent = text;
    }
    
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function removeTypingIndicator() {
    const indicators = messages.querySelectorAll('.typing');
    indicators.forEach(i => i.closest('.msg').remove());
  }

  ws.addEventListener("message", (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      if (payload.reply) {
        // Short delay so the dots are actually visible for a moment
        setTimeout(() => {
          removeTypingIndicator();
          addBubble(payload.reply, "bot");
        }, 600); 
      }
    } catch (e) { console.error(e); }
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastSentTime < RATE_LIMIT_MS) {
      addBubble("Please wait a moment before sending another message.", "bot");
      return;
    }
    lastSentTime = now;

    addBubble(text, "user");
    input.value = "";
    
    // Trigger the 3-dot balls
    addBubble("", "bot", { isTyping: true });
    
    ws.send(JSON.stringify({ message: text, sessionId }));
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
});