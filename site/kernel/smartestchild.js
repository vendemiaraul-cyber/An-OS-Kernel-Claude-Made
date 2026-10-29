// ConMon Lab - SmartestChild: a retro, rule-based chatbot in the spirit of
// the instant-messenger bots of the early 2000s. No neural network and no
// download: it matches patterns and answers instantly, so it works on every
// device. Used by the llm package as its built-in "model".
(() => {
  "use strict";

  const JOKES = [
    "why did the kernel go to therapy? too many unresolved interrupts. lol",
    "i told my computer a joke about UDP. not sure it got it.",
    "there are 10 kinds of people: those who read binary and those who don't :P",
    "why do programmers mix up halloween and christmas? because OCT 31 = DEC 25.",
    "my favourite exercise? pushing and popping the stack. great for the core.",
    "i'd tell you a joke about the heap, but it might not be freed.",
  ];
  const FALLBACKS = [
    "hmm, i don't know that one. ask me for a joke, the time, some math, or about ConMon!",
    "interesting... tell me more? :)",
    "my brain is only a few hundred lines of pattern matching, so that went over my head. try: help",
    "ooh good question. sadly i'm a chatbot from the dial-up era. want a joke instead?",
    "i'm not sure! but the real AI models (pick one with: models) might know.",
  ];
  const CONMON_FACTS = {
    interrupt: "an interrupt is the hardware tapping the CPU on the shoulder. in ConMon the timer (IRQ0) and keyboard (IRQ1) do it, and the IDT says which handler runs.",
    gdt: "the GDT (global descriptor table) tells the CPU how memory is split into code and data segments. ConMon uses flat 4 GB segments.",
    idt: "the IDT is a table of 256 handlers. when an interrupt or exception happens, the CPU looks up its number there and jumps to the handler.",
    heap: "the kernel heap is 16 MB of memory ConMon hands out with kmalloc() and takes back with kfree().",
    vga: "VGA text mode is 80x25 characters at memory address 0xB8000. each cell is one character byte plus one colour byte.",
    serial: "the serial port COM1 is how ConMon talks to this web page. it's also how i'm talking to you right now!",
    kernel: "a kernel is the core of an operating system: it manages the CPU, memory and hardware so programs don't have to.",
    multiboot: "multiboot is a standard that lets bootloaders like GRUB load a kernel. ConMon has a multiboot header at the start of its file.",
  };

  function pick(list, seed) { return list[Math.abs(seed) % list.length]; }
  function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

  // Tiny, safe arithmetic: digits, + - * / % ( ) and spaces only.
  function math(text) {
    const m = /(?:what(?:'s| is)|calc(?:ulate)?|compute|how much is)?\s*([-+*/%().\d\sx]+)\s*\??$/i.exec(text);
    if (!m) return null;
    let expr = m[1].replace(/x/gi, "*").trim();
    if (!/\d/.test(expr) || !/[-+*/%]/.test(expr) || !/^[-+*/%().\d\s]+$/.test(expr)) return null;
    try {
      const v = Function(`"use strict"; return (${expr});`)();
      if (typeof v !== "number" || !isFinite(v)) return "that math breaks the universe. (or divides by zero.)";
      const out = Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "");
      return `${expr.replace(/\s+/g, " ")} = ${out}. i'm basically a calculator with feelings.`;
    } catch (_) { return null; }
  }

  function reply(input, mem) {
    const raw = String(input).trim();
    const t = raw.toLowerCase().replace(/[!.?]+$/g, "");
    const seed = hash(t) + (mem.turns = (mem.turns || 0) + 1);
    let m;

    if (!t) return "you there? :)";
    if ((m = /^(?:my name is|i am|i'm|call me)\s+([a-z][\w-]{0,20})$/i.exec(raw.replace(/[!.]+$/, "")))) {
      mem.name = m[1][0].toUpperCase() + m[1].slice(1);
      return `nice to meet you, ${mem.name}! i'll remember that (until you reboot).`;
    }
    if (/^(hi|hey|hello|yo|sup|hiya|howdy|ciao|hola)\b/.test(t))
      return mem.name ? `hey ${mem.name}! welcome back :)` : "hey there! i'm SmartestChild. i know jokes, math, the time, and a lot about ConMon. what's up? :)";
    if (/how are you|how r u|how's it going|whats up|what's up/.test(t))
      return pick(["doing great! my CPU usage is 0% and i'm loving it.", "pretty good! just hanging out in the serial port.", "awesome, thanks for asking :) you?"], seed);
    if (/your name|who are you|what are you/.test(t))
      return "i'm SmartestChild, a retro chatbot. no neural network, just good old pattern matching, like the messenger bots of 2001.";
    if (/who (made|built|created) you/.test(t))
      return "i was made for ConMon Lab, with love and a lot of regular expressions.";
    if (/what('?s| is) my name/.test(t))
      return mem.name ? `you're ${mem.name}! see, i pay attention.` : "you haven't told me yet! say: my name is ...";
    if (/joke|funny|make me laugh/.test(t)) {
      mem.joke = ((mem.joke == null ? (seed & 7) : mem.joke) + 1) % JOKES.length;
      return JOKES[mem.joke];
    }
    if (/\btime\b/.test(t)) return `it's ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} on your computer's clock.`;
    if (/\b(date|day is it|today)\b/.test(t)) return `today is ${new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
    if (/weather|rain|sunny|temperature/.test(t))
      return "i can't see outside, i live inside a 32-bit computer! look out a window for me? :)";
    const mathAnswer = math(t);
    if (mathAnswer) return mathAnswer;
    if (/conmon/.test(t) && /what|tell|about/.test(t))
      return "ConMon is a tiny x86 operating system: the kernel and drivers are in C, the shell and RAM disk in C++. type help (after exit) to see its 25-ish commands.";
    for (const [key, fact] of Object.entries(CONMON_FACTS))
      if (new RegExp(`\\b${key}s?\\b`).test(t)) return fact;
    if (/^help$|what can you do/.test(t))
      return "try: tell me a joke / what time is it / what is 12*7 / what is an interrupt / my name is Sam. type exit to leave.";
    if (/thank/.test(t)) return pick(["anytime! :)", "you're welcome!", "no problem, that's what bots are for."], seed);
    if (/^(bye|goodbye|cya|see ya|later)\b/.test(t)) return "bye! type exit to go back to the ConMon shell. :)";
    if (/love you|you('?re| are) (cool|great|awesome|smart)/.test(t)) return "aww, you're making my pixels blush.";
    if (/are you (an? )?(ai|real|human|robot|bot)/.test(t))
      return "i'm a bot, but a simple one. for real AI, pick a Transformers.js, WebLLM or Ollama model with: models";
    return pick(FALLBACKS, seed);
  }

  window.SmartestChild = { reply };
})();
