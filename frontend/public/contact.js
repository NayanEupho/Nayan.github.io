const form = document.querySelector("[data-contact-form]");
const status = document.querySelector("[data-contact-status]");

function setStatus(message, kind = "") {
  if (!status) return;
  status.textContent = message;
  status.className = `contact-status ${kind}`.trim();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type='submit']");
  const payload = Object.fromEntries(new FormData(form));

  button.disabled = true;
  setStatus("Sending...");

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not send the message");

    form.reset();
    setStatus("Thanks — your message has been sent.", "success");
  } catch (error) {
    setStatus(error.message || "Could not send the message", "error");
  } finally {
    button.disabled = false;
  }
});
