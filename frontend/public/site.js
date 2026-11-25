const html = document.documentElement;
const themeToggle = document.querySelector(".theme-toggle");

html.setAttribute("data-theme", localStorage.getItem("theme") || "dark");

function applyTheme(theme) {
  html.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

themeToggle?.addEventListener("click", () => {
  const next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
  if (document.startViewTransition) {
    document.startViewTransition(() => applyTheme(next));
  } else {
    applyTheme(next);
  }
});

function updateClock() {
  const localTime = document.getElementById("localTime");
  if (!localTime) return;
  const timeZone = document.querySelector("[data-timezone]")?.dataset.timezone || "Asia/Kolkata";

  const now = new Date().toLocaleString("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  localTime.textContent = now;
}

updateClock();
setInterval(updateClock, 1000);

console.log(
  "%clooks like you love to poke around,\nwill love to talk — nayanmodicd@gmail.com",
  "font-family: ui-monospace, SF Mono, Monaco, monospace; font-size: 13px; line-height: 1.6; color: #93c5fd; padding: 8px 0;"
);
